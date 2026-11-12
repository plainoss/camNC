import { readFileSync } from 'node:fs';
import {
  addCopyTransform,
  addPartCut,
  addRectangle,
  cadPartReference,
  copyOperationPrefix,
  createCadPart,
  parseCadDocument,
  setCadVariable,
  setCopyOperationOrder,
  solveCadDocument,
  type CadDocument,
} from '@wbcnc/cad';
import { profileFeatures } from '@wbcnc/cam';
import { expect, it } from 'vitest';
import { boundaryVolume } from '@/test/orderedCopyFixture';
import { assemblyModel, instanceKey } from './assemblyModel';
import { studioCutParts } from './studioGeometry';
import { physicalFaceFrame } from './studioGeometryReaders';

const recipes = {
  cabinet: {
    fixture: 'task-start-cupboard-three-shelves',
    family: 'Shelf',
    count: 'shelves',
    start: { width: 800, board: 18 },
    edited: { width: 860, board: 21 },
    others: ['Side', 'Right side', 'Bottom', 'Top', 'Back'],
  },
  tray: {
    fixture: 'divided-tray-copy-tools',
    family: 'Divider',
    count: 'dividers',
    start: { width: 420, board: 15 },
    edited: { width: 480, board: 18 },
    others: ['Base', 'Left wall', 'Right wall', 'Front wall', 'Back wall'],
  },
} as const;

function variable(document: CadDocument, name: string, expression: string) {
  const source = document.variables!.find(variable => variable.name === name)!;
  const result = setCadVariable(document, { ...source, expression });
  if ('error' in result) throw Error(result.error);
  return result.document;
}

async function solve(document: CadDocument) {
  const bytes = JSON.stringify(document),
    result = await solveCadDocument(document);
  expect(result.status, JSON.stringify(result.diagnostics)).toBe('solved');
  expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([]);
  expect(JSON.stringify(document)).toBe(bytes);
  return result;
}

function knife(cabinet: boolean, later: boolean) {
  const tool = createCadPart(later ? 'Later knife' : 'Earlier knife', cabinet ? 1000 : 20);
  tool.sketch = addRectangle(tool.sketch, {
    x: cabinet ? (later ? 150 : 100) : -100,
    y: later ? (cabinet ? 390 : 405) : cabinet ? -10 : 5,
    width: cabinet ? 20 : 1000,
    height: cabinet ? 40 : 30,
    dimensioned: true,
    positioned: true,
  });
  if (!cabinet) {
    const position = tool.sketch.constraints.find(constraint => constraint.type === 'positionY')!;
    if (position.type !== 'positionY') throw Error('Missing knife position.');
    position.expression = later ? 'board + 390mm' : 'board - 10mm';
  }
  tool.drawnOn = { on: { plane: 'top' }, offset: cabinet ? 0 : later ? 30 : 60 };
  return tool;
}

it.each(['cabinet', 'tray'] as const)(
  'keeps the complete %s physical model and CAM tied to one ordered state',
  async recipe => {
    const intent = recipes[recipe],
      cabinet = recipe === 'cabinet';
    let source: CadDocument = JSON.parse(
      readFileSync(new URL(`../../../../packages/cad-script/fixtures/designs/${intent.fixture}.json`, import.meta.url), 'utf8')
    );
    source = variable(source, intent.count, '3');
    const a = knife(cabinet, false),
      b = knife(cabinet, true);
    const initial = await solve({ ...source, parts: [...source.parts, a, b] });
    const owner = initial.document.parts.find(part => part.name === intent.family)!,
      copyId = owner.copies![1]!.id;
    const reference = cadPartReference(owner.id, copyId),
      legacyIds = initial.document.partCuts!.map(cut => cut.id);
    const sourceIds = initial.document.parts.map(part => part.id),
      patternId = owner.pattern!.id;
    const move = addCopyTransform(initial.document, owner.id, copyId, { by: [0, 400, 0] });
    const first = addPartCut(move.document, [a.id], [reference], { value: 0 });
    const second = addPartCut(first.document, [b.id], [reference], { value: 0 });
    let current = setCopyOperationOrder(second.document, [...legacyIds, first.id, move.id, second.id]);
    const savedMove = JSON.stringify(current.copyTransforms);
    for (const state of [
      { ...intent.start, count: 3 },
      { ...intent.edited, count: 4 },
      { ...intent.edited, count: 2 },
      { ...intent.edited, count: 3 },
    ]) {
      current = variable(
        variable(variable(current, 'board', `${state.board}mm`), 'width', `${state.width}mm`),
        intent.count,
        String(state.count)
      );
      // Source edits reconcile dependent sketch patterns before the portable save/reload boundary.
      const regenerated = await solve(current),
        loaded = parseCadDocument(JSON.parse(JSON.stringify(regenerated.document)));
      const solved = await solve(loaded);
      current = solved.document;
      const bytes = JSON.stringify(current),
        model = assemblyModel(current);
      expect(current.parts.map(part => part.id)).toEqual(sourceIds);
      expect(current.copyTransforms).toEqual(JSON.parse(savedMove));
      expect(current.operationOrder).toEqual([...legacyIds, first.id, move.id, second.id]);
      const family = current.parts.find(part => part.id === owner.id)!;
      expect(family.copies!.map(copy => copy.id)).toEqual(
        Array.from({ length: state.count - 1 }, (_, index) => `${patternId}:${index + 1}`)
      );
      const names = Array.from({ length: state.count }, (_, index) => (index ? `${intent.family} ${index + 1}` : intent.family));
      expect(model.instances.map(instance => instance.name).sort()).toEqual(
        [...intent.others, ...names, 'Earlier knife', 'Later knife'].sort()
      );
      const pieces = studioCutParts(solved);
      expect(pieces.flatMap(piece => piece.names).sort()).toEqual(model.instances.map(instance => instance.name).sort());
      const stock = cabinet
        ? (state.width - 2 * state.board - 2) * 284 * state.board
        : (240 - 2 * state.board) * (80 - state.board + 4) * state.board;
      const notch = (cabinet ? 20 * 30 : 20 * 20) * state.board;
      for (let slot = 1; slot <= state.count; slot++) {
        const id = slot > 1 ? family.copies![slot - 2]!.id : undefined;
        const key = instanceKey({ partId: owner.id, copyId: id });
        const index = model.instances.findIndex(instance => instanceKey(instance) === key),
          mesh = model.meshes[index]!;
        expect(boundaryVolume(mesh.positions, mesh.indices), `${recipe} slot${slot} rendered material`).toBeCloseTo(
          stock - (slot === 3 ? 2 * notch : 0),
          4
        );
        const handoff = pieces.find(piece => piece.names.includes(names[slot - 1]!))!;
        const cam = profileFeatures(handoff.part);
        expect(cam.problem).toBeUndefined();
        expect(cam.features.levels.reduce((sum, level) => sum + level.z * level.area, 0)).toBeCloseTo(
          stock - (slot === 3 ? 2 * notch : 0),
          5
        );
      }
      if (state.count === 2) {
        expect(model.instances.some(instance => instance.partId === owner.id && instance.copyId === copyId)).toBe(false);
        expect(model.problems.some(problem => /copy/i.test(problem.message))).toBe(true);
      } else {
        expect(model.problems).toEqual([]);
        const bottom = (3 * (900 - state.board)) / (state.count + 1),
          left = state.board / 2 + (3 * (state.width - 2 * state.board)) / (state.count + 1);
        const origin = cabinet ? [0, 400, bottom] : [left, 400, 0];
        origin.forEach((value, axis) => expect(model.placements.get(`${owner.id}/${copyId}`)!.position[axis]).toBeCloseTo(value, 6));
        expect(family.copies![1]!.placement!.position[1]).toBe(0);
        const face = physicalFaceFrame(current, { partId: owner.id, copyId, face: 'top' });
        expect(face).not.toHaveProperty('error');
        if ('error' in face) throw Error(face.error);
        const faceOrigin = cabinet ? [0, 400, bottom + state.board] : [left + state.board, 400, 0];
        faceOrigin.forEach((value, axis) => expect(face.origin[axis]).toBeCloseTo(value, 6));
        const prefix = assemblyModel(copyOperationPrefix(current, move.id));
        const selected = prefix.instances.findIndex(instance => instance.partId === owner.id && instance.copyId === copyId);
        expect(boundaryVolume(prefix.meshes[selected]!.positions, prefix.meshes[selected]!.indices)).toBeCloseTo(stock - notch, 4);
      }
      const earlier = assemblyModel(copyOperationPrefix(current, legacyIds.at(-1)!));
      for (const name of intent.others) {
        const before = earlier.instances.findIndex(instance => instance.name === name),
          after = model.instances.findIndex(instance => instance.name === name);
        expect(model.meshes[after]!.positions, `${name} keeps its earlier material/pose`).toEqual(earlier.meshes[before]!.positions);
        expect(model.meshes[after]!.indices).toEqual(earlier.meshes[before]!.indices);
      }
      expect(JSON.stringify(current)).toBe(bytes);
    }
  },
  30_000
);
