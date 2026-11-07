import { expect, it } from 'vitest';
import {
  addCenterRectangle,
  addInscribedPolygon,
  createCadPart,
  createCadDocument,
  offsetSketch,
  addLine,
  chamferLineCorners,
  createPlateDocument,
  parseCadDocument,
  resolveChamferCorners,
  solveCadDocument,
  updateDimension,
  validateCadDocument,
  type CadLineEntity,
  type CadPointEntity,
} from './index';
const lines = (doc: ReturnType<typeof createPlateDocument>) =>
  doc.parts[0]!.sketch.entities.filter((e): e is CadLineEntity => e.type === 'line' && !e.construction);
it('retains virtual corners and original plate dimensions with two independently editable setbacks', async () => {
  const doc = createPlateDocument({ width: 120, height: 80 });
  const before = structuredClone(doc);
  const bottom = lines(doc)[0]!;
  const result = chamferLineCorners(doc.parts[0]!.sketch, { cornerPointIds: [bottom.endId], distanceA: 10, distanceB: 20 });
  if (!result.ok) throw new Error(result.message);
  expect(doc).toEqual(before);
  doc.parts[0]!.sketch = result.sketch;
  expect(validateCadDocument(doc)).toEqual([]);
  expect(parseCadDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  const solved = await solveCadDocument(doc);
  expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  expect(solved.sketches[0]!.dof).toBe(0);
  expect(solved.parts[0]!.loops[0]!.entityIds).toHaveLength(5);
  const resized = await solveCadDocument(updateDimension(solved.document, result.dimensionIds[0], 15));
  expect(resized.status, JSON.stringify(resized.diagnostics)).toBe('solved');
  const sketch = resized.document.parts[0]!.sketch;
  const point = (id: string) => sketch.entities.find(e => e.id === id) as CadPointEntity;
  const virtual = point(bottom.endId);
  expect(virtual).toMatchObject({ x: 120, y: 0, construction: true });
  const edge = sketch.entities.find(e => e.id === result.lineIds[0]) as CadLineEntity;
  expect(Math.hypot(point(edge.startId).x - virtual.x, point(edge.startId).y - virtual.y)).toBeCloseTo(15, 7);
  expect(Math.hypot(point(edge.endId).x - virtual.x, point(edge.endId).y - virtual.y)).toBeCloseTo(20, 7);
});
it('shares both setback drivers across four corners and rejects summed edge consumption atomically', async () => {
  const doc = createPlateDocument({ width: 120, height: 80 });
  const sketch = doc.parts[0]!.sketch;
  const selection = resolveChamferCorners(
    sketch,
    lines(doc).map(e => e.id)
  );
  expect(selection.ok).toBe(true);
  const options = { cornerPointIds: selection.cornerPointIds, distanceA: 8, distanceB: 12 };
  const result = chamferLineCorners(sketch, options);
  if (!result.ok) throw new Error(result.message);
  doc.parts[0]!.sketch = result.sketch;
  expect(result.lineIds).toHaveLength(4);
  expect(result.sketch.constraints.filter(c => c.type === 'equal')).toHaveLength(6);
  const solved = await solveCadDocument(updateDimension(doc, result.dimensionIds[1], 16));
  expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  expect(solved.sketches[0]!.dof).toBe(0);
  expect(solved.parts[0]!.loops[0]!.entityIds).toHaveLength(8);
  const before = structuredClone(sketch);
  expect(chamferLineCorners(sketch, { ...options, distanceA: 50, distanceB: 50 }).ok).toBe(false);
  expect(chamferLineCorners(sketch, { ...options, distanceA: NaN }).ok).toBe(false);
  expect(sketch).toEqual(before);
});
it('assigns asymmetric distances by selected line order and handles construction corners', async () => {
  const doc = createPlateDocument({ width: 120, height: 80 });
  const [a, b] = lines(doc);
  const result = chamferLineCorners(doc.parts[0]!.sketch, {
    cornerPointIds: [a!.endId],
    distanceA: 5,
    distanceB: 15,
    selectedLineIds: [b!.id, a!.id],
  });
  if (!result.ok) throw new Error(result.message);
  const dimension = result.sketch.constraints.find(c => c.id === result.dimensionIds[0]);
  expect(dimension?.type).toBe('distance');
  if (dimension?.type !== 'distance') throw new Error('missing dimension');
  const cut = result.sketch.entities.find(e => e.id === dimension.pointBId) as CadPointEntity;
  expect(cut).toMatchObject({ x: 120, y: 5 });
  let sketch = doc.parts[0]!.sketch;
  sketch = addLine(sketch, { x1: 200, y1: 0, x2: 220, y2: 0, construction: true });
  const first = sketch.entities.at(-1) as CadLineEntity;
  sketch = addLine(sketch, { x1: 220, y1: 0, x2: 220, y2: 20, construction: true });
  const second = sketch.entities.at(-1) as CadLineEntity;
  sketch.constraints.push({ id: 'test-joint', type: 'coincident', pointAId: first.endId, pointBId: second.startId });
  const selection = resolveChamferCorners(sketch, [first.id, second.id]);
  expect(selection.ok).toBe(true);
  const construction = chamferLineCorners(sketch, { cornerPointIds: selection.cornerPointIds, distanceA: 3, distanceB: 4 });
  if (!construction.ok) throw new Error(construction.message);
  expect(construction.sketch.entities.find(e => e.id === construction.lineIds[0])?.construction).toBe(true);
});

it('ignores construction diagonals at center-rectangle corners and preserves the original dimensions', async () => {
  const part = createCadPart();
  part.sketch = addCenterRectangle(part.sketch, { x: 60, y: 40, width: 120, height: 80, dimensioned: true });
  const doc = { ...createCadDocument(), parts: [part] };
  const edges = lines(doc);
  const selected = resolveChamferCorners(part.sketch, [edges[0]!.id, edges[1]!.id]);
  expect(selected.ok).toBe(true);
  const byPoint = resolveChamferCorners(part.sketch, [edges[0]!.endId]);
  expect(byPoint.ok).toBe(true);
  const result = chamferLineCorners(part.sketch, { cornerPointIds: byPoint.cornerPointIds, distanceA: 8, distanceB: 12 });
  if (!result.ok) throw new Error(result.message);
  part.sketch = result.sketch;
  const solved = await solveCadDocument(doc);
  expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  expect(solved.parts[0]!.loops[0]!.entityIds).toHaveLength(5);
});
it('releases only finite polygon/offset ownership while retaining unrelated dimensions', async () => {
  const part = createCadPart();
  part.sketch = addInscribedPolygon(part.sketch, { center: { x: 60, y: 60 }, point: { x: 90, y: 60 }, sides: 5 });
  const edge = part.sketch.entities.find(e => e.type === 'line')!;
  const result = chamferLineCorners(part.sketch, { cornerPointIds: [edge.startId], distanceA: 3, distanceB: 4 });
  if (!result.ok) throw new Error(result.message);
  expect(result.sketch.constraints.some(c => c.type === 'regularPolygon')).toBe(false);
  expect((await solveCadDocument({ ...createCadDocument(), parts: [{ ...part, sketch: result.sketch }] })).status).toBe('solved');
  const doc = createPlateDocument();
  const source = doc.parts[0]!.sketch;
  const offset = offsetSketch(source, { entityIds: lines(doc).map(e => e.id), value: 4, wholeLoop: true });
  if (!offset.ok) throw new Error(offset.message);
  const copy = offset.sketch.entities.find(e => e.id === offset.entityIds[0]) as CadLineEntity;
  const cut = chamferLineCorners(offset.sketch, { cornerPointIds: [copy.startId], distanceA: 2, distanceB: 2 });
  if (!cut.ok) throw new Error(cut.message);
  expect(cut.sketch.constraints.some(c => c.type === 'offset')).toBe(false);
  for (const c of source.constraints) expect(cut.sketch.constraints).toContainEqual(c);
  expect((await solveCadDocument({ ...doc, parts: [{ ...doc.parts[0]!, sketch: cut.sketch }] })).status).toBe('solved');
});
