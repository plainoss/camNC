import { expect, it } from 'vitest';
import {
  addCopyTransform,
  addFaceSketch,
  addPartCut,
  addRectangle,
  cadFaceFrame,
  cadPartReference,
  cadPartsToCut,
  cadSketchRegions,
  createCadPart,
  createPlateDocument,
  evaluateCadDocument,
  evaluateCadPart,
  evaluateCadPartFamily,
  physicalCadView,
  parseCadDocument,
  resolveDrawnPlacements,
  resolvePartPatterns,
  setCutDepth,
  setPartPattern,
  updatePartCut,
  withUsedPoints,
  type CadDocument,
  type CadPointEntity,
} from './index';

function fixture() {
  let source = createPlateDocument({ width: 100, height: 60, thickness: 18 });
  const family = source.parts[0]!,
    partId = family.id;
  family.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  source = setPartPattern(source, partId, { count: 3, axis: 'x', spacing: 200 });
  const copyId = source.parts[0]!.copies![1]!.id;
  const point = family.sketch.entities.find((entity): entity is CadPointEntity => entity.type === 'point' && !entity.construction)!;
  const dependent = createCadPart('Dependent', 6);
  dependent.sketch = addRectangle(dependent.sketch, { x: 0, y: 0, width: 10, height: 10 });
  dependent.drawnOn = { on: { partId, copyId, face: 'top' }, offset: 2 };
  dependent.moved = { by: [3, 4, 5], turn: { about: [400, 0, 20], axis: [0, 0, 1], degrees: 90 } };
  const used = createCadPart('Used generation', 6);
  used.sketch = addRectangle(used.sketch, { x: 0, y: 0, width: 10, height: 10 });
  used.drawnOn = { on: { plane: 'top' }, offset: 0 };
  used.sketch.entities.push({
    id: 'generation-reference',
    type: 'point',
    x: 400,
    y: 0,
    construction: true,
    fixed: true,
    used: { partId, copyId, pointId: point.id, side: 'top' },
  });
  const tool = createCadPart('Knife', 18),
    receiver = createCadPart('Receiver', 18);
  tool.sketch = addRectangle(tool.sketch, { x: 400, y: 0, width: 10, height: 20 });
  receiver.sketch = addRectangle(receiver.sketch, { x: 395, y: -5, width: 20, height: 30 });
  for (const part of [tool, receiver]) part.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  source.parts.push(dependent, used, tool, receiver);
  const face = addFaceSketch(source, dependent.id, 'underside');
  source = face.document;
  const local = source.parts.find(part => part.id === dependent.id)!;
  const sketch = local.features!.find(feature => feature.type === 'sketch')!;
  if (sketch.type !== 'sketch') throw Error('Missing face sketch');
  sketch.sketch = addRectangle(sketch.sketch, { x: -8, y: 2, width: 3, height: 3 });
  sketch.sketch.entities.push({
    id: 'face-generation-reference',
    type: 'point',
    x: 400,
    y: 0,
    construction: true,
    fixed: true,
    used: { partId, copyId, pointId: point.id, side: 'top' },
  });
  const region = cadSketchRegions(local, face.sketchId).find(region => !region.curveIds.includes(`${dependent.id}:outline`))!;
  source = setCutDepth(source, dependent.id, face.sketchId, region.id, 2);
  source = resolvePartPatterns(resolveDrawnPlacements(source).document);
  const first = addPartCut(source, [tool.id], [cadPartReference(partId, copyId)], { value: 0 });
  const move = addCopyTransform(first.document, partId, copyId, { by: [100, 0, 0] });
  const consume = addPartCut(move.document, [tool.id], [receiver.id], { value: 0 });
  source = updatePartCut(consume.document, consume.id, { consumeTools: true });
  return { source, partId, copyId, dependent: dependent.id, used: used.id, tool: tool.id, first: first.id, move: move.id };
}

const body = (document: CadDocument, id: string) => document.parts.find(part => part.id === id)!;

it('freezes placed body drawnOn/moved regeneration in the physical view while retaining finite faces and material', () => {
  const f = fixture(),
    before = JSON.stringify(f.source),
    evaluation = evaluateCadDocument(f.source);
  expect(evaluation.diagnostics).toEqual([]);
  const view = physicalCadView(f.source, evaluation),
    projected = body(view.document, f.dependent);
  expect(projected.placement!.position).toEqual([403, 4, 25]);
  const regenerated = resolvePartPatterns(resolveDrawnPlacements(view.document).document);
  expect(body(regenerated, f.dependent).placement).toEqual(projected.placement);
  expect(body(regenerated, f.partId).copies![1]!.placement!.position).toEqual([500, 0, 0]);
  const frame = cadFaceFrame(regenerated, { partId: f.dependent, face: 'top' });
  expect(frame).toEqual(expect.objectContaining({ origin: [403, 4, 31], x: [0, 1, 0], normal: [0, 0, 1] }));
  const generated = evaluateCadPartFamily(projected, evaluateCadPart(projected).part!).part;
  expect(generated).toEqual(evaluation.parts.find(part => part.partId === f.dependent));
  expect(generated.cuts).toContainEqual(expect.objectContaining({ side: 'underside', from: 0, to: 2 }));
  expect(JSON.stringify(f.source)).toBe(before);
  expect(body(f.source, f.dependent).drawnOn).toBeDefined();
  expect(body(f.source, f.dependent).moved).toBeDefined();
});

it('freezes existing Used generation bindings in projected profile and face sketches without changing raw references', () => {
  const f = fixture(),
    before = JSON.stringify(f.source),
    view = physicalCadView(f.source, evaluateCadDocument(f.source));
  const projected = body(view.document, f.used),
    original = body(f.source, f.used);
  const updated = withUsedPoints(view.document, projected);
  expect(updated.entities.find(entity => entity.id === 'generation-reference')).toEqual(expect.objectContaining({ x: 400, y: 0 }));
  expect(updated).toBe(projected.sketch);
  const dependent = body(view.document, f.dependent),
    face = dependent.features!.find(feature => feature.type === 'sketch')!;
  if (face.type !== 'sketch') throw Error('Missing projected face');
  expect(withUsedPoints(view.document, { ...dependent, sketch: face.sketch })).toBe(face.sketch);
  expect(face.sketch.entities.find(entity => entity.id === 'face-generation-reference')).not.toHaveProperty('used');
  const rawFace = body(f.source, f.dependent).features!.find(feature => feature.type === 'sketch')!;
  if (rawFace.type !== 'sketch') throw Error('Missing raw face');
  expect(rawFace.sketch.entities.find(entity => entity.id === 'face-generation-reference')).toHaveProperty('used.copyId', f.copyId);
  expect(original.sketch.entities.find(entity => entity.id === 'generation-reference')).toHaveProperty('used.copyId', f.copyId);
  expect(JSON.stringify(f.source)).toBe(before);
});

it('keeps prefix poses, future consumption and repeated physical queries in the same finite state', () => {
  const f = fixture(),
    before = JSON.stringify(f.source);
  const opening = evaluateCadDocument(f.source, { through: f.first }),
    moved = evaluateCadDocument(f.source, { through: f.move }),
    final = evaluateCadDocument(f.source);
  for (const [result, x] of [
    [opening, 400],
    [moved, 500],
    [final, 500],
  ] as const) {
    const view = physicalCadView(f.source, result),
      again = resolvePartPatterns(resolveDrawnPlacements(view.document).document);
    expect(body(again, f.partId).copies![1]!.placement!.position).toEqual([x, 0, 0]);
    expect(body(again, f.dependent).placement!.position).toEqual([403, 4, 25]);
    expect(physicalCadView(f.source, result)).toEqual(view);
  }
  const prefix = physicalCadView(f.source, moved),
    last = physicalCadView(f.source, final);
  expect(cadPartsToCut(prefix.document, prefix.parts).flatMap(group => group.names)).toContain('Knife');
  expect(cadPartsToCut(last.document, last.parts).flatMap(group => group.names)).not.toContain('Knife');
  expect(last.parts.some(part => part.partId === f.tool)).toBe(false);
  const loaded = parseCadDocument(JSON.parse(before));
  expect(JSON.stringify(loaded)).toBe(before);
  expect(body(loaded, f.dependent).drawnOn).toBeDefined();
  expect(body(loaded, f.dependent).moved).toBeDefined();
  expect(evaluateCadDocument(loaded)).toEqual(final);
  expect(physicalCadView(loaded, evaluateCadDocument(loaded))).toEqual(last);
  expect(JSON.stringify(f.source)).toBe(before);
});

it('retains evaluated Used coordinates for unplaced physical bodies without inventing a pose', () => {
  const f = fixture(),
    unplaced = body(f.source, f.used);
  delete unplaced.drawnOn;
  delete unplaced.placement;
  const before = JSON.stringify(f.source),
    evaluation = evaluateCadDocument(f.source);
  expect(evaluation.available).toContain(f.used);
  expect(evaluation.placements).not.toHaveProperty(f.used);
  const view = physicalCadView(f.source, evaluation),
    projected = body(view.document, f.used);
  const queried = withUsedPoints(view.document, projected);
  expect(queried.entities.find(entity => entity.id === 'generation-reference')).toEqual(expect.objectContaining({ x: 400, y: 0 }));
  expect(queried).toBe(projected.sketch);
  expect(projected.placement).toBeUndefined();
  expect(JSON.stringify(f.source)).toBe(before);
  expect(unplaced.sketch.entities.find(entity => entity.id === 'generation-reference')).toHaveProperty('used.copyId', f.copyId);
});
