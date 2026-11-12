import { expect, it } from 'vitest';
import {
  addCopyTransform,
  addFaceSketch,
  addLine,
  addPartCopy,
  addRectangle,
  cadSketchRegions,
  createCadPart,
  createPlateDocument,
  evaluateCadDocument,
  isJoinedBody,
  evaluateCadPart,
  evaluateCadPartFamily,
  newExtrudeOf,
  newExtrudeOnFace,
  orderedCadDocument,
  parseCadDocument,
  physicalCadView,
  polygonArea,
  resolveDrawnPlacements,
  resolveExtrudeSteps,
  setCutDepth,
  type CadDocument,
  type CadPart,
  type EvaluatedCadPart,
} from './index';

const area = (shape: EvaluatedCadPart) => Math.abs(polygonArea(shape.outline));
const generated = (part: CadPart) => {
  const result = evaluateCadPart(part);
  expect(result.part, `${part.name}: ${JSON.stringify(result.diagnostics)}`).toBeDefined();
  return evaluateCadPartFamily(part, result.part!).part;
};
const read = (document: CadDocument, id: string) => document.parts.find(part => part.id === id)!;
function split() {
  const document = createPlateDocument({ width: 100, height: 50, thickness: 18 }),
    owner = document.parts[0]!;
  owner.drawnOn = { on: { plane: 'top' }, offset: 0 };
  owner.sketch = addLine(owner.sketch, { x1: 30, y1: 0, x2: 30, y2: 50 });
  const regions = cadSketchRegions(owner, owner.sketch.id);
  owner.regions = [regions.find(region => Math.abs(polygonArea(region.points)) === 70 * 50)!.id];
  return { document, owner };
}
function unchangedSource(source: CadDocument, before: string) {
  expect(JSON.stringify(source)).toBe(before);
  const saved = parseCadDocument(JSON.parse(before));
  expect(JSON.stringify(saved)).toBe(before);
  expect(evaluateCadDocument(saved)).toEqual(evaluateCadDocument(source));
}

it('retains face-extrude and shared-sketch cached geometry and poses through read-only generation queries', () => {
  const setup = split(),
    owner = setup.owner;
  let document = setup.document;
  const face = newExtrudeOnFace(document, { partId: owner.id, face: 'top' }, 'Raised face');
  const shared = newExtrudeOf(document, owner, 'Shared narrow');
  shared.moved = { by: [0, 200, 5] };
  document.parts.push(face, shared);
  document = resolveDrawnPlacements(resolveExtrudeSteps(document)).document;
  const copied = addPartCopy(document, owner.id, { offset: { position: [300, 0, 0], rotation: [0, 0, 0, 1] } });
  const source = addCopyTransform(copied.document, owner.id, copied.id, { by: [100, 0, 0] }).document,
    before = JSON.stringify(source);
  const evaluation = evaluateCadDocument(source),
    view = physicalCadView(source, evaluation);
  expect(evaluation.diagnostics).toEqual([]);
  const queried = resolveDrawnPlacements(resolveExtrudeSteps(view.document)).document;
  expect(area(generated(read(queried, face.id)))).toBe(70 * 50);
  expect(area(generated(read(queried, shared.id)))).toBe(30 * 50);
  expect(read(queried, shared.id).placement!.position).toEqual([0, 200, 5]);
  for (const id of [face.id, shared.id]) {
    expect(generated(read(queried, id))).toEqual(evaluation.parts.find(part => part.partId === id));
    expect(read(queried, id).sketch.id).toBe(read(source, id).sketch.id);
    expect(read(queried, id).regions).toEqual(read(source, id).regions);
  }
  expect(read(source, face.id).faceProfile).toBe(true);
  expect(read(source, shared.id).sketchOf).toBe(owner.id);
  unchangedSource(source, before);
});

it('retains cached Add regions when their nonphysical generator rows are absent from the view', () => {
  const setup = split(),
    owner = setup.owner;
  let document = setup.document;
  const add = newExtrudeOf(document, owner, 'Add narrow');
  add.addTo = owner.id;
  document.parts.push(add);
  document = resolveDrawnPlacements(resolveExtrudeSteps(document)).document;
  const source = orderedCadDocument(document),
    before = JSON.stringify(source),
    evaluation = evaluateCadDocument(source),
    view = physicalCadView(source, evaluation);
  expect(read(source, owner.id).addedRegions).toHaveLength(1);
  const queried = resolveExtrudeSteps(view.document),
    shape = generated(read(queried, owner.id));
  expect(area(shape)).toBe(100 * 50);
  expect(shape).toEqual(evaluation.parts.find(part => part.partId === owner.id));
  expect(read(queried, owner.id).regions).toEqual([...owner.regions!, ...read(source, owner.id).addedRegions!]);
  expect(read(source, add.id).addTo).toBe(owner.id);
  unchangedSource(source, before);
});

it('retains cached Remove cuts and their pocket-floor references without regenerating absent source steps', () => {
  let document = createPlateDocument({ width: 100, height: 50, thickness: 18 }),
    owner = document.parts[0]!;
  owner.drawnOn = { on: { plane: 'top' }, offset: 0 };
  const remove = createCadPart('Pocket generator', 18);
  remove.sketch = addRectangle(remove.sketch, { x: 20, y: 10, width: 20, height: 20 });
  remove.drawnOn = { on: { partId: owner.id, face: 'top' }, offset: 0 };
  remove.remove = { depth: 6 };
  document.parts.push(remove);
  document = resolveExtrudeSteps(document);
  owner = read(document, owner.id);
  const first = owner.features!.find(feature => feature.type === 'cut')!;
  const face = addFaceSketch(document, owner.id, { floorOf: first.id });
  document = face.document;
  owner = read(document, owner.id);
  const sketch = owner.features!.find(feature => feature.type === 'sketch' && feature.sketch.id === face.sketchId)!;
  if (sketch.type !== 'sketch') throw Error('Missing pocket-floor sketch');
  sketch.sketch = addRectangle(sketch.sketch, { x: 25, y: 15, width: 5, height: 5 });
  const region = cadSketchRegions(owner, face.sketchId).find(region => !region.curveIds.includes(`${owner.id}:outline`))!;
  document = setCutDepth(document, owner.id, face.sketchId, region.id, 2);
  const source = orderedCadDocument(resolveDrawnPlacements(document).document),
    before = JSON.stringify(source),
    evaluation = evaluateCadDocument(source);
  expect(evaluation.diagnostics).toEqual([]);
  const view = physicalCadView(source, evaluation),
    queried = resolveExtrudeSteps(view.document),
    shape = generated(read(queried, owner.id));
  const volume =
    area(shape) * 18 - (shape.cuts ?? []).reduce((sum, cut) => sum + Math.abs(polygonArea(cut.outline)) * (cut.to - cut.from), 0);
  expect(volume).toBe(100 * 50 * 18 - 20 * 20 * 6 - 5 * 5 * 2);
  expect(shape).toEqual(evaluation.parts.find(part => part.partId === owner.id));
  expect(read(queried, owner.id).features!.map(feature => feature.id)).toEqual(read(source, owner.id).features!.map(feature => feature.id));
  expect(read(queried, owner.id).features!.find(feature => feature.type === 'sketch' && feature.id === sketch.id)).toHaveProperty(
    'on.floorOf',
    first.id
  );
  expect(read(source, owner.id).features!.some(feature => feature.removedBy === remove.id)).toBe(true);
  unchangedSource(source, before);
});

it('preserves independent Add-body membership and generated local material for parent-copy assembly readers', () => {
  let source = createPlateDocument({ width: 100, height: 50, thickness: 18 });
  const parent = source.parts[0]!;
  parent.drawnOn = { on: { plane: 'top' }, offset: 0 };
  const boss = createCadPart('Joined boss', 6);
  boss.sketch = addRectangle(boss.sketch, { x: 0, y: 0, width: 20, height: 20 });
  boss.addTo = parent.id;
  boss.drawnOn = { on: { partId: parent.id, face: 'top' }, offset: 0 };
  source.parts.push(boss);
  source = resolveDrawnPlacements(source).document;
  const copy = addPartCopy(source, parent.id, { offset: { position: [200, 0, 0], rotation: [0, 0, 0, 1] } });
  source = addCopyTransform(copy.document, parent.id, copy.id, { by: [100, 0, 0] }).document;
  const before = JSON.stringify(source),
    evaluation = evaluateCadDocument(source),
    view = physicalCadView(source, evaluation);
  const queried = resolveDrawnPlacements(resolveExtrudeSteps(view.document)).document,
    projected = read(queried, boss.id);
  expect(isJoinedBody(queried, projected)).toBe(true);
  expect(projected.addTo).toBe(parent.id);
  expect(projected.placement!.position).toEqual([0, 0, 18]);
  expect(read(queried, parent.id).copies![0]!.placement!.position).toEqual([300, 0, 0]);
  expect(area(generated(projected)) * projected.thickness).toBe(20 * 20 * 6);
  expect(generated(projected)).toEqual(evaluation.parts.find(part => part.partId === boss.id));
  unchangedSource(source, before);
});
