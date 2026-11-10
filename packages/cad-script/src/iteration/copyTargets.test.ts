import {
  addPartCut,
  addRectangle,
  cadPartReference,
  cadPartsToCut,
  createCadPart,
  evaluatedPartCopy,
  parseCadDocument,
  solveCadDocument,
  updatePartCut,
  type CadDocument,
  type EvaluatedCadPart,
} from '@wbcnc/cad';
import { profileFeatures } from '@wbcnc/cam';
import { expect, it } from 'vitest';
import { axisMaterial } from './axisMaterial';
import { loadWoodworkingSource, sourcePart, sourceVariable } from './woodworkingChecks';

type Solved = Awaited<ReturnType<typeof solveCadDocument>>;
type Recipe = 'cabinet' | 'tray';

const recipes = {
  cabinet: {
    fixture: 'task-start-cupboard-three-shelves',
    family: 'Shelf',
    count: 'shelves',
    tool: 'Cable chase',
    stockVolume: 762 * 284 * 18,
    removal: 20 * 30 * 18,
    otherPieces: ['Side', 'Right side', 'Bottom', 'Top', 'Back', 'Cable chase'],
  },
  tray: {
    fixture: 'divided-tray-copy-tools',
    family: 'Divider',
    count: 'dividers',
    tool: 'Crossrail',
    stockVolume: 210 * 69 * 15,
    removal: 15 * 20 * 20,
    otherPieces: ['Base', 'Left wall', 'Right wall', 'Front wall', 'Back wall', 'Crossrail'],
  },
} as const;

function crossingTool(recipe: Recipe) {
  // These authored blocks intersect every repeated board. A mistaken family target therefore changes siblings too.
  const cabinet = recipe === 'cabinet';
  const part = createCadPart(recipes[recipe].tool, cabinet ? 900 : 20);
  part.sketch = addRectangle(part.sketch, {
    x: cabinet ? 100 : 15,
    y: cabinet ? -10 : 100,
    width: cabinet ? 20 : 390,
    height: cabinet ? 40 : 20,
    dimensioned: true,
    positioned: true,
  });
  part.drawnOn = { on: { plane: 'top' }, offset: cabinet ? 0 : 60 };
  return part;
}

async function solve(document: CadDocument) {
  const before = JSON.stringify(document);
  const solved = await solveCadDocument(document);
  expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  expect(solved.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
  expect(JSON.stringify(document)).toBe(before);
  return solved;
}

function shape(part: EvaluatedCadPart) {
  return { thickness: part.thickness, outline: part.outline, holes: part.holes, cuts: part.cuts ?? [] };
}

function physical(result: Solved, recipe: Recipe, slot: number) {
  const source = sourcePart(result.document, recipes[recipe].family);
  const evaluated = result.parts.find(part => part.partId === source.id)!;
  const copy = slot > 1 ? source.copies![slot - 2]! : null;
  return { shape: copy ? evaluatedPartCopy(evaluated, copy) : evaluated, placement: (copy ?? source).placement! };
}

function probe(recipe: Recipe, slot: number, count: number, insideNotch: boolean) {
  if (recipe === 'cabinet') {
    // The fixture recipe is 800x900x300,18 mm stock,6 mm back, with equally spaced shelves.
    const gap = (900 - 2 * 18 - count * 18) / (count + 1);
    return [110, insideNotch ? 15 : 45, slot * (18 + gap) + 9];
  }
  // Tray recipe:420x240x80,15 mm stock,4 mm housing; each divider straddles its pitch center.
  const center = 15 + (slot * (420 - 2 * 15)) / (count + 1);
  return [center, insideNotch ? 110 : 140, 70];
}

function checkScene(result: Solved, baseline: Solved, recipe: Recipe, count: number, cutSlots: number[], stepId: string) {
  const intent = recipes[recipe];
  const pieces = cadPartsToCut(result.document, result.parts);
  const familyNames = Array.from({ length: count }, (_, i) => (i ? `${intent.family} ${i + 1}` : intent.family));
  expect(pieces.flatMap(group => group.names).sort()).toEqual([...intent.otherPieces, ...familyNames].sort());
  expect(new Set(pieces.flatMap(group => group.names)).size).toBe(count + intent.otherPieces.length);
  expect(result.document.parts.map(part => part.id)).toEqual(baseline.document.parts.map(part => part.id));
  for (let slot = 1; slot <= count; slot++) {
    const body = physical(result, recipe, slot);
    const material = axisMaterial(body.shape, body.placement);
    const expected = intent.stockVolume - (cutSlots.includes(slot) ? intent.removal : 0);
    expect(material.volume, `${intent.family} slot ${slot} occupied volume`).toBeCloseTo(expected, 5);
    expect(material.components).toBe(1);
    expect(material.containsWorld(probe(recipe, slot, count, true))).toBe(!cutSlots.includes(slot));
    expect(material.containsWorld(probe(recipe, slot, count, false))).toBe(true);
    const cuts = (body.shape.cuts ?? []).filter(cut => cut.id.startsWith(`cut-parts:${stepId}:`));
    expect(cuts, `${intent.family} slot ${slot} cut multiplicity`).toHaveLength(cutSlots.includes(slot) ? 1 : 0);
    const handoff = pieces.find(group => group.names.includes(familyNames[slot - 1]!))!;
    const cam = profileFeatures(handoff.part);
    expect(cam.problem).toBeUndefined();
    expect(cam.below).toBeNull();
    expect(cam.features.outlines).toHaveLength(1);
    expect(cam.features.levels.reduce((volume, level) => volume + level.z * level.area, 0)).toBeCloseTo(expected, 5);
    expect(shape(handoff.part)).toEqual(shape(body.shape));
  }
  const originalPieces = cadPartsToCut(baseline.document, baseline.parts);
  for (const name of intent.otherPieces) {
    // Divider count changes move its original base housings; check those against the independent recipe below.
    if (recipe === 'tray' && name === 'Base') continue;
    const before = originalPieces.find(group => group.names.includes(name))!;
    const after = pieces.find(group => group.names.includes(name))!;
    expect(shape(after.part), `${name} is unchanged by the new target cut`).toEqual(shape(before.part));
  }
  if (recipe === 'tray') {
    const base = sourcePart(result.document, 'Base');
    const evaluated = result.parts.find(part => part.partId === base.id)!;
    const material = axisMaterial(evaluated, base.placement!);
    expect(material.volume).toBeCloseTo(420 * 240 * 15 - count * 15 * 210 * 4, 5);
    expect(evaluated.cuts).toHaveLength(count);
    expect(material.containsWorld([2, 2, 10])).toBe(true);
    for (let slot = 1; slot <= count; slot++) {
      const center = 15 + (slot * (420 - 2 * 15)) / (count + 1);
      expect(material.containsWorld([center, 120, 13])).toBe(false);
    }
  }
  return pieces;
}

const reload = (document: CadDocument) => parseCadDocument(JSON.parse(JSON.stringify(document)));
const ownCutIds = (result: Solved, recipe: Recipe, slot: number, stepId: string) =>
  (physical(result, recipe, slot).shape.cuts ?? []).filter(cut => cut.id.startsWith(`cut-parts:${stepId}:`)).map(cut => cut.id);

it.each(['cabinet', 'tray'] as const)(
  'keeps exact copy targets through the complete %s geometry, count edits, reload and CAM handoff',
  async recipe => {
    const intent = recipes[recipe];
    let document = sourceVariable(await loadWoodworkingSource(intent.fixture), intent.count, '3');
    const tool = crossingTool(recipe);
    document = { ...document, parts: [...document.parts, tool] };
    const baseline = await solve(document);
    expect(baseline.diagnostics).toEqual([]);
    const source = sourcePart(baseline.document, intent.family);
    const [second, third] = source.copies!;
    const references = [second!, third!].map(copy => cadPartReference(source.id, copy.id));
    const added = addPartCut(baseline.document, [tool.id], [references[0]!], { value: 0 });
    const before = JSON.stringify(added.document);
    let current = await solve(added.document);
    let pieces = checkScene(current, baseline, recipe, 3, [2], added.id);
    expect(current.diagnostics).toEqual([]);
    expect(JSON.stringify(added.document)).toBe(before);
    expect(current.document.parts).toEqual(baseline.document.parts);
    expect(current.document.partCuts!.find(step => step.id === added.id)).toMatchObject({
      tools: [tool.id],
      targets: [references[0]],
    });
    const targetName = `${intent.family} 2`;
    const targetCamId = pieces.find(group => group.names.includes(targetName))!.part.partId;
    const originalCutIds = ownCutIds(current, recipe, 2, added.id);
    expect(pieces.find(group => group.names.includes(intent.family))!.names).toEqual([intent.family, `${intent.family} 3`]);
    expect(pieces.find(group => group.names.includes(targetName))!.names).toEqual([targetName]);

    for (const count of [2, 3]) {
      current = await solve(reload(sourceVariable(current.document, intent.count, String(count))));
      expect(current.diagnostics).toEqual([]);
      pieces = checkScene(current, baseline, recipe, count, [2], added.id);
      expect(sourcePart(current.document, intent.family).copies!.map(copy => copy.id)).toEqual([second!.id, third!.id].slice(0, count - 1));
      expect(current.document.partCuts!.find(step => step.id === added.id)!.targets).toEqual([references[0]]);
      expect(ownCutIds(current, recipe, 2, added.id)).toEqual(originalCutIds);
      expect(pieces.find(group => group.names.includes(targetName))!.part.partId).toBe(targetCamId);
    }

    current = await solve(updatePartCut(current.document, added.id, { targets: [references[1]!] }));
    pieces = checkScene(current, baseline, recipe, 3, [3], added.id);
    const thirdCamId = pieces.find(group => group.names.includes(`${intent.family} 3`))!.part.partId;
    const thirdCutIds = ownCutIds(current, recipe, 3, added.id);
    const absent = await solve(reload(sourceVariable(current.document, intent.count, '2')));
    // An absent persisted slot is explicitly unresolved; its current position never selects a replacement body.
    expect(absent.diagnostics).toMatchObject([{ code: 'part-cut-target-missing', severity: 'warning' }]);
    expect(absent.diagnostics).toHaveLength(1);
    expect(absent.diagnostics[0]!.message).toMatch(/copy.*(?:no longer exists|not present|gone|missing)/i);
    expect(absent.document.partCuts!.find(step => step.id === added.id)!.targets).toEqual([references[1]]);
    checkScene(absent, baseline, recipe, 2, [], added.id);
    current = await solve(reload(sourceVariable(absent.document, intent.count, '3')));
    expect(current.diagnostics).toEqual([]);
    pieces = checkScene(current, baseline, recipe, 3, [3], added.id);
    expect(sourcePart(current.document, intent.family).copies!.map(copy => copy.id)).toEqual([second!.id, third!.id]);
    expect(current.document.partCuts!.find(step => step.id === added.id)!.targets).toEqual([references[1]]);
    expect(ownCutIds(current, recipe, 3, added.id)).toEqual(thirdCutIds);
    expect(pieces.find(group => group.names.includes(`${intent.family} 3`))!.part.partId).toBe(thirdCamId);

    const duplicate = updatePartCut(current.document, added.id, {
      targets: [references[0]!, source.id, source.id, references[0]!],
    });
    const duplicateBefore = JSON.stringify(duplicate);
    const family = await solve(reload(duplicate));
    expect(family.diagnostics).toEqual([]);
    pieces = checkScene(family, baseline, recipe, 3, [1, 2, 3], added.id);
    expect(pieces.find(group => group.names.includes(intent.family))!.names).toEqual([
      intent.family,
      `${intent.family} 2`,
      `${intent.family} 3`,
    ]);
    expect(JSON.stringify(duplicate)).toBe(duplicateBefore);
    expect(added.document.partCuts!.find(step => step.id === added.id)!.targets).toEqual([references[0]]);
  },
  30_000
);
