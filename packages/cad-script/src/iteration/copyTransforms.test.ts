import {
  addCopyTransform,
  addPartCut,
  addRectangle,
  cadPartReference,
  cadPartsToCut,
  copyOperationPrefix,
  createCadPart,
  evaluateCadDocument,
  evaluatedPartCopy,
  parseCadDocument,
  physicalCadView,
  setCopyOperationOrder,
  solveCadDocument,
  updatePartCut,
  type CadDocument,
  type CadEvaluation,
  type EvaluatedCadPart,
} from '@wbcnc/cad';
import { profileFeatures } from '@wbcnc/cam';
import { expect, it } from 'vitest';
import { axisMaterial } from './axisMaterial';
import { loadWoodworkingSource, sourcePart, sourceVariable } from './woodworkingChecks';

type Recipe = 'cabinet' | 'tray';
const shift = 400;
const recipes = {
  cabinet: {
    fixture: 'task-start-cupboard-three-shelves',
    family: 'Shelf',
    count: 'shelves',
    original: { width: 800, board: 18 },
    edited: { width: 860, board: 21 },
    others: ['Side', 'Right side', 'Bottom', 'Top', 'Back'],
    consumeTarget: 'Bottom',
  },
  tray: {
    fixture: 'divided-tray-copy-tools',
    family: 'Divider',
    count: 'dividers',
    original: { width: 420, board: 15 },
    edited: { width: 480, board: 18 },
    others: ['Base', 'Left wall', 'Right wall', 'Front wall', 'Back wall'],
    consumeTarget: 'Front wall',
  },
} as const;

const reload = (document: CadDocument) => parseCadDocument(JSON.parse(JSON.stringify(document)));
const localMaterial = ({ thickness, outline, holes, cuts = [] }: EvaluatedCadPart) => ({ thickness, outline, holes, cuts });
const identities = (document: CadDocument) =>
  document.parts.map(part => ({
    id: part.id,
    sketch: part.sketch.id,
    entities: part.sketch.entities.map(entity => entity.id),
    constraints: part.sketch.constraints.map(constraint => constraint.id),
    features: part.features?.map(feature => feature.id),
    pattern: part.pattern?.id,
  }));

async function solve(document: CadDocument) {
  const before = JSON.stringify(document);
  const result = await solveCadDocument(document);
  expect(result.status, JSON.stringify(result.diagnostics)).toBe('solved');
  expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([]);
  expect(JSON.stringify(document)).toBe(before);
  return result;
}

function knife(recipe: Recipe, later: boolean) {
  const cabinet = recipe === 'cabinet';
  const part = createCadPart(later ? 'Later knife' : 'Earlier knife', cabinet ? 1000 : 20);
  part.sketch = addRectangle(part.sketch, {
    x: cabinet ? (later ? 150 : 100) : -100,
    y: cabinet ? (later ? shift - 10 : -10) : later ? shift + 5 : 5,
    width: cabinet ? 20 : 1000,
    height: cabinet ? 40 : 30,
    dimensioned: true,
    positioned: true,
  });
  if (!cabinet) {
    const position = part.sketch.constraints.find(constraint => constraint.type === 'positionY');
    if (!position || position.type !== 'positionY') throw Error('Missing authored knife position.');
    position.expression = later ? 'board + 390mm' : 'board - 10mm';
  }
  part.drawnOn = { on: { plane: 'top' }, offset: cabinet ? 0 : later ? 30 : 60 };
  return part;
}

/** Handwritten fixture recipes. No expected dimension, pose, volume or probe reads candidate geometry. */
function expected(recipe: Recipe, width: number, board: number, count: number, slot: number, moved: boolean) {
  const cabinet = recipe === 'cabinet';
  const front = cabinet ? 0 : board;
  const bottom = cabinet ? (slot * (900 - board)) / (count + 1) : board - 4;
  const left = cabinet ? board + 1 : board / 2 + (slot * (width - 2 * board)) / (count + 1);
  const y = front + (moved ? shift : 0);
  const center = cabinet ? 110 : left + board / 2;
  return {
    stock: cabinet ? (width - 2 * board - 2) * 284 * board : (240 - 2 * board) * (80 - board + 4) * board,
    removal: cabinet ? 20 * 30 * board : 20 * 20 * board,
    origin: cabinet ? [0, moved ? shift : 0, bottom] : [left, moved ? shift : 0, 0],
    bounds: {
      min: [left, y, bottom],
      max: cabinet ? [width - board - 1, y + 284, bottom + board] : [left + board, y + 240 - 2 * board, 80],
    },
    first: [center, y + (cabinet ? 15 : 10), cabinet ? bottom + board / 2 : 70],
    second: [cabinet ? 160 : center, y + (cabinet ? 15 : 10), cabinet ? bottom + board / 2 : 40],
    retained: [cabinet ? 210 : center, y + 50, cabinet ? bottom + board / 2 : 40],
  };
}

function physical(document: CadDocument, result: CadEvaluation, recipe: Recipe, slot: number) {
  const view = physicalCadView(document, result);
  const family = sourcePart(view.document, recipes[recipe].family);
  const shape = view.parts.find(part => part.partId === family.id)!;
  const copy = slot > 1 ? family.copies![slot - 2]! : null;
  return { shape: copy ? evaluatedPartCopy(shape, copy) : shape, placement: (copy ?? family).placement! };
}

function checkFamily(
  document: CadDocument,
  result: CadEvaluation,
  recipe: Recipe,
  width: number,
  board: number,
  count: number,
  stage: 'first' | 'move' | 'second'
) {
  const view = physicalCadView(document, result);
  const pieces = cadPartsToCut(view.document, view.parts);
  const names = Array.from({ length: count }, (_, index) => (index ? `${recipes[recipe].family} ${index + 1}` : recipes[recipe].family));
  expect(pieces.flatMap(group => group.names).sort()).toEqual([...recipes[recipe].others, ...names, 'Earlier knife', 'Later knife'].sort());
  if (recipe === 'tray') {
    const base = sourcePart(view.document, 'Base');
    const floor = axisMaterial(view.parts.find(part => part.partId === base.id)!, base.placement!);
    expect(floor.volume).toBeCloseTo(width * 240 * board - count * board * (240 - 2 * board) * 4, 5);
    for (let slot = 1; slot <= count; slot++) {
      const center = board + (slot * (width - 2 * board)) / (count + 1);
      // The earlier housing stays at its authored floor location after the third divider is moved away.
      expect(floor.containsWorld([center, 120, board - 2])).toBe(false);
      expect(floor.containsWorld([center, 120, board - 6])).toBe(true);
    }
  } else {
    for (const name of ['Bottom', 'Top', 'Back']) {
      const source = sourcePart(view.document, name);
      const material = axisMaterial(view.parts.find(part => part.partId === source.id)!, source.placement!);
      const volume = (width - 2 * board + 16) * (name === 'Back' ? 900 * 6 : 294 * board);
      expect(material.volume, `${name} keeps its independent stock volume`).toBeCloseTo(volume, 5);
    }
  }
  for (let slot = 1; slot <= count; slot++) {
    const selected = slot === 3;
    const moved = selected && stage !== 'first';
    const intent = expected(recipe, width, board, count, slot, moved);
    const body = physical(document, result, recipe, slot);
    const material = axisMaterial(body.shape, body.placement);
    const removed = selected ? (stage === 'second' ? 2 : 1) : 0;
    const volume = intent.stock - removed * intent.removal;
    expect(material.volume, `${recipe} slot ${slot}: occupied material at ${stage}`).toBeCloseTo(volume, 5);
    expect(material.components).toBe(1);
    intent.bounds.min.forEach((value, axis) => expect(material.bounds.min[axis]).toBeCloseTo(value, 6));
    intent.bounds.max.forEach((value, axis) => expect(material.bounds.max[axis]).toBeCloseTo(value, 6));
    expect(material.containsWorld(intent.first)).toBe(!selected);
    expect(material.containsWorld(intent.second)).toBe(!(selected && stage === 'second'));
    expect(material.containsWorld(intent.retained)).toBe(true);
    const handoff = pieces.find(group => group.names.includes(names[slot - 1]!))!;
    const cam = profileFeatures(handoff.part);
    expect(cam.problem).toBeUndefined();
    expect(cam.features.outlines).toHaveLength(1);
    expect(cam.features.levels.reduce((sum, level) => sum + level.z * level.area, 0)).toBeCloseTo(volume, 5);
    expect(localMaterial(handoff.part)).toEqual(localMaterial(body.shape));
  }
}

it.each(['cabinet', 'tray'] as const)(
  'carries one %s copy through ordered cuts, parameter edits, missing slots, reload and CAM',
  async recipe => {
    const setup = recipes[recipe];
    let source = sourceVariable(await loadWoodworkingSource(setup.fixture), setup.count, '3');
    const earlier = knife(recipe, false),
      later = knife(recipe, true);
    source = { ...source, parts: [...source.parts, earlier, later] };
    const baseline = await solve(source);
    const family = sourcePart(baseline.document, setup.family);
    const target = family.copies![1]!.id,
      reference = cadPartReference(family.id, target);
    const originalIdentities = identities(baseline.document);
    const legacy = baseline.document.partCuts!.map(cut => cut.id);
    const moved = addCopyTransform(baseline.document, family.id, target, { by: [0, shift, 0] });
    const first = addPartCut(moved.document, [earlier.id], [reference], { value: 0 });
    const second = addPartCut(first.document, [later.id], [reference], { value: 0 });
    let current = setCopyOperationOrder(second.document, [...legacy, first.id, moved.id, second.id]);
    const savedMove = JSON.stringify(current.copyTransforms);
    let originalCamId: string | undefined;

    for (const state of [
      { ...setup.original, count: 3 },
      { ...setup.edited, count: 3 },
      { ...setup.edited, count: 4 },
      { ...setup.edited, count: 2 },
      { ...setup.edited, count: 3 },
    ]) {
      current = sourceVariable(
        sourceVariable(sourceVariable(current, 'board', `${state.board}mm`), 'width', `${state.width}mm`),
        setup.count,
        String(state.count)
      );
      // The normal edit pipeline reconciles dependent sketch-pattern cells before saving portable source.
      const regenerated = await solve(current);
      const solved = await solve(reload(regenerated.document));
      current = solved.document;
      expect(identities(current)).toEqual(originalIdentities);
      const sourceFamily = sourcePart(current, setup.family);
      expect(sourceFamily.copies!.map(copy => copy.id)).toEqual(
        Array.from({ length: state.count - 1 }, (_, index) => `${family.pattern!.id}:${index + 1}`)
      );
      expect(current.operationOrder).toEqual([...legacy, first.id, moved.id, second.id]);
      expect(current.legacyPartCutIds).toEqual(legacy);
      expect(JSON.stringify(current.copyTransforms)).toBe(savedMove);
      for (const id of [first.id, second.id]) expect(current.partCuts!.find(cut => cut.id === id)!.targets).toEqual([reference]);
      if (state.count === 2) {
        expect(solved.available).not.toContain(reference);
        expect(solved.placements).not.toHaveProperty(reference);
        expect(solved.diagnostics).toContainEqual(expect.objectContaining({ code: 'copy-transform-target-missing' }));
        checkFamily(current, solved, recipe, state.width, state.board, state.count, 'second');
        continue;
      }
      expect(
        solved.diagnostics,
        JSON.stringify({
          state,
          knives: solved.parts.filter(part => [earlier.id, later.id].includes(part.partId)).map(part => part.outline),
        })
      ).toEqual([]);
      const origin = expected(recipe, state.width, state.board, state.count, 3, false).origin;
      origin.forEach((value, axis) => expect(sourceFamily.copies![1]!.placement!.position[axis]).toBeCloseTo(value, 6));
      expected(recipe, state.width, state.board, state.count, 3, true).origin.forEach((value, axis) =>
        expect(solved.placements![reference]!.position[axis]).toBeCloseTo(value, 6)
      );
      const afterFirst = evaluateCadDocument(current, { through: first.id });
      const afterMove = evaluateCadDocument(current, { through: moved.id });
      checkFamily(current, afterFirst, recipe, state.width, state.board, state.count, 'first');
      checkFamily(current, afterMove, recipe, state.width, state.board, state.count, 'move');
      checkFamily(current, solved, recipe, state.width, state.board, state.count, 'second');
      expect(evaluateCadDocument(reload(copyOperationPrefix(current, moved.id)))).toEqual(afterMove);
      const handoff = cadPartsToCut(current, solved.parts, solved).find(group => group.names.includes(`${setup.family} 3`))!;
      if (originalCamId === undefined) originalCamId = handoff.part.partId;
      expect(handoff.part.partId).toBe(originalCamId);
      const legacyOnly = evaluateCadDocument(copyOperationPrefix(current, legacy.at(-1)!));
      const oldView = physicalCadView(current, legacyOnly),
        newView = physicalCadView(current, solved);
      const oldPieces = cadPartsToCut(oldView.document, oldView.parts),
        newPieces = cadPartsToCut(newView.document, newView.parts);
      for (const name of setup.others) {
        const before = oldPieces.find(group => group.names.includes(name))!,
          after = newPieces.find(group => group.names.includes(name))!;
        expect(localMaterial(after.part), `${name} retains its own material`).toEqual(localMaterial(before.part));
      }
    }

    // A later successful consume must not hide its tool in an earlier rollback view.
    const targetPart = sourcePart(current, setup.consumeTarget);
    const consumed = addPartCut(current, [earlier.id], [targetPart.id], { value: 0 });
    const consumeSource = updatePartCut(consumed.document, consumed.id, { consumeTools: true });
    const beforeConsume = evaluateCadDocument(consumeSource, { through: second.id });
    const prefixView = physicalCadView(consumeSource, beforeConsume);
    expect(cadPartsToCut(prefixView.document, prefixView.parts).flatMap(group => group.names)).toContain('Earlier knife');
    expect(beforeConsume.available).toContain(earlier.id);
    const afterConsume = await solve(reload(consumeSource));
    expect(afterConsume.available).not.toContain(earlier.id);
    const endView = physicalCadView(afterConsume.document, afterConsume);
    expect(cadPartsToCut(endView.document, endView.parts).flatMap(group => group.names)).not.toContain('Earlier knife');
    const { width, board } = setup.edited;
    const targetShape = afterConsume.parts.find(part => part.partId === targetPart.id)!;
    const targetAt = endView.document.parts.find(part => part.id === targetPart.id)!.placement!;
    const expectedTarget =
      recipe === 'cabinet'
        ? (width - 2 * board + 16) * 294 * board - 20 * 30 * board
        : (width - 2 * board) * (80 - board) * board - (width - 2 * board) * 20 * 10;
    const legacySource = { ...afterConsume.document, version: baseline.document.version };
    delete legacySource.operationOrder;
    delete legacySource.copyTransforms;
    delete legacySource.legacyPartCutIds;
    const legacyEvaluation = evaluateCadDocument(legacySource);
    const legacyShape = legacyEvaluation.parts.find(part => part.partId === targetPart.id)!;
    // Only this final consume has identical material in the two histories; the selected copy must differ.
    expect(localMaterial(targetShape)).toEqual(localMaterial(legacyShape));
    const handoff = cadPartsToCut(endView.document, endView.parts).find(group => group.names.includes(setup.consumeTarget))!;
    const legacyHandoff = cadPartsToCut(legacySource, legacyEvaluation.parts).find(group => group.names.includes(setup.consumeTarget))!;
    expect(localMaterial(handoff.part)).toEqual(localMaterial(legacyHandoff.part));
    const { turned, ...cam } = profileFeatures(handoff.part);
    const { turned: legacyTurned, ...legacyCam } = profileFeatures(legacyHandoff.part);
    expect(cam.problem).toBeUndefined();
    expect(cam).toEqual(legacyCam);
    expect(!!turned).toBe(!!legacyTurned);
    if (turned) for (const axis of ['x', 'y'] as const) expect(turned(axis)).toEqual(legacyTurned!(axis));
    const actualTarget = axisMaterial(targetShape, targetAt).volume;
    if (recipe === 'cabinet') expect(actualTarget).toBeCloseTo(expectedTarget, 5);
    else {
      // The saved front-plane quarter turn predates these operations and stores q to nine decimals.
      // Each Y/Z row differs from an exact quarter turn by at most 2r, r=|1-2q²|. Two carries over
      // this 80 mm reach give (4r+4r²)*80; 64ε*80 covers their scalar floating-point arithmetic.
      expect(targetAt.rotation).toEqual([0.707106781, 0, 0, 0.707106781]);
      const residual = Math.abs(1 - 2 * targetAt.rotation[0]! ** 2);
      const faceError = 4 * residual * (1 + residual) * 80 + 64 * Number.EPSILON * 80;
      const cuts = targetShape.cuts!.filter(cut => cut.id.startsWith(`cut-parts:${consumed.id}:`));
      expect(cuts).toHaveLength(1);
      const cut = cuts[0]!;
      expect(cut).toMatchObject({ side: 'underside', from: 0, through: false, islands: [] });
      expect(Math.abs(cut.to - 10)).toBeLessThanOrEqual(faceError);
      expect(cut.outline).toHaveLength(4);
      const corners = [
        [board, 60],
        [width - board, 60],
        [width - board, 80],
        [board, 80],
      ];
      cut.outline.forEach((point, index) => {
        expect(Math.abs(point.x - corners[index]![0]!)).toBeLessThanOrEqual(faceError);
        expect(Math.abs(point.y - corners[index]![1]!)).toBeLessThanOrEqual(faceError);
      });
      const span = width - 2 * board;
      const volumeError =
        (span + 2 * faceError) * (20 + 2 * faceError) * (10 + faceError) - span * 20 * 10 + 32 * Number.EPSILON * expectedTarget;
      expect(Math.abs(actualTarget - expectedTarget)).toBeLessThanOrEqual(volumeError);
    }
    expect(JSON.stringify(afterConsume.document.copyTransforms)).toBe(savedMove);
  },
  30_000
);
