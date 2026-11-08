import { expect, it } from 'vitest';
import {
  addPoint,
  addInscribedPolygon,
  inscribedPolygonFromPoints,
  addConstraint,
  createCadDocument,
  createCadPart,
  solveCadDocument,
  parseCadDocument,
  evaluateCadDocument,
  removeEntity,
} from './index';
it.each([3, 4, 6, 50])('keeps %s sides regular around an inscribed circle and preserves its freedom', async sides => {
  const part = createCadPart();
  part.sketch = addInscribedPolygon(part.sketch, { center: { x: 40, y: 50 }, point: { x: 60, y: 50 }, sides });
  const solved = await solveCadDocument({ ...createCadDocument(), parts: [part] });
  expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  expect(solved.sketches[0]!.dof).toBe(4);
  const sketch = solved.document.parts[0]!.sketch,
    circle = sketch.entities.find(e => e.type === 'circle')!;
  expect(circle.construction).toBe(true);
  expect(circle.radius).toBeCloseTo(20);
  const points = new Map(sketch.entities.filter(e => e.type === 'point').map(e => [e.id, e]));
  const center = points.get(circle.centerId)!;
  const edges = sketch.entities.filter(e => e.type === 'line');
  expect(edges).toHaveLength(sides);
  for (const edge of edges) {
    const a = points.get(edge.startId)!,
      b = points.get(edge.endId)!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    expect(Math.abs((b.x - a.x) * (center.y - a.y) - (b.y - a.y) * (center.x - a.x)) / length).toBeCloseTo(20, 5);
    expect(length).toBeCloseTo(40 * Math.tan(Math.PI / sides), 5);
  }
  expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document)))).toEqual(solved.document);
  expect(evaluateCadDocument(solved.document).parts).toHaveLength(1);
});
it('retains all sides and regularity when the definition-circle diameter changes', async () => {
  const part = createCadPart();
  part.sketch = addInscribedPolygon(part.sketch, { center: { x: 40, y: 50 }, point: { x: 60, y: 70 }, sides: 5 });
  const circle = part.sketch.entities.find(e => e.type === 'circle')!;
  part.sketch = addConstraint(part.sketch, { type: 'diameter', entityId: circle.id, value: 100 });
  const solved = await solveCadDocument({ ...createCadDocument(), parts: [part] });
  expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  expect(solved.sketches[0]!.dof).toBe(3);
  expect(solved.document.parts[0]!.sketch.entities.find(e => e.type === 'circle')!.radius).toBeCloseTo(50);
  expect(evaluateCadDocument(solved.document).parts).toHaveLength(1);
});
it('rejects invalid sides/radius, retains construction and drops deleted-edge regularity dependencies', () => {
  const part = createCadPart(),
    options = { center: { x: 40, y: 50 }, point: { x: 60, y: 50 }, sides: 6 };
  for (const sides of [2, 51, 3.5, NaN]) expect(() => addInscribedPolygon(part.sketch, { ...options, sides })).toThrow();
  expect(inscribedPolygonFromPoints(options.center, options.center, 6)).toBeNull();
  const sketch = addInscribedPolygon(part.sketch, { ...options, construction: true });
  expect(sketch.entities.filter(e => e.type === 'line').every(e => e.construction)).toBe(true);
  const line = sketch.entities.find(e => e.type === 'line')!;
  expect(removeEntity(sketch, line.id).constraints.some(c => c.type === 'regularPolygon')).toBe(false);
  const document = { ...createCadDocument(), parts: [{ ...part, sketch }] };
  const malformed = JSON.parse(JSON.stringify(document));
  malformed.parts[0].sketch.constraints.find((c: { type: string }) => c.type === 'regularPolygon').edgeIds = [];
  expect(() => parseCadDocument(malformed)).toThrow(/regular polygon/);
});

it('keeps a fixed polygon valid and reports distorted fixed angles against its regularity relation', async () => {
  const part = createCadPart();
  part.sketch = addInscribedPolygon(part.sketch, { center: { x: 60, y: 70 }, point: { x: 80, y: 70 }, sides: 5 });
  part.sketch.entities = part.sketch.entities.map(e => (e.type === 'point' ? { ...e, fixed: true } : e));
  const doc = { ...createCadDocument(), parts: [part] };
  expect((await solveCadDocument(doc)).status).toBe('solved');
  const bad = {
    ...doc,
    parts: [
      {
        ...part,
        sketch: {
          ...part.sketch,
          entities: part.sketch.entities.map(e =>
            e.type === 'point' && e.id !== part.sketch.entities[0]!.id ? { ...e, x: 60 + (e.x - 60) * 1.1 } : e
          ),
        },
      },
    ],
  };
  const result = await solveCadDocument(bad);
  expect(result.status).toBe('conflict');
  const relation = part.sketch.constraints.find(c => c.type === 'regularPolygon')!;
  expect(result.diagnostics.some(d => d.constraintIds?.includes(relation.id))).toBe(true);
});

it('reports user-visible relation IDs for an incompatible anchored diameter edit', async () => {
  const part = createCadPart();
  part.sketch = addInscribedPolygon(part.sketch, { center: { x: 60, y: 70 }, point: { x: 80, y: 70 }, sides: 6 });
  const circle = part.sketch.entities.find(e => e.type === 'circle')!,
    edge = part.sketch.entities.find(e => e.type === 'line')!;
  part.sketch.entities = part.sketch.entities.map(e => (e.type === 'point' && e.id === circle.centerId ? { ...e, fixed: true } : e));
  part.sketch = addPoint(part.sketch, { x: 80, y: 70, fixed: true });
  const point = part.sketch.entities.at(-1)!;
  part.sketch = addConstraint(part.sketch, { type: 'midpoint', pointId: point.id, entityId: edge.id });
  part.sketch = addConstraint(part.sketch, { type: 'diameter', entityId: circle.id, value: 100 });
  const result = await solveCadDocument({ ...createCadDocument(), parts: [part] });
  expect(result.status).toBe('conflict');
  const ids = result.diagnostics.flatMap(d => d.constraintIds ?? []);
  expect(ids.length).toBeGreaterThan(0);
  expect(ids.every(id => part.sketch.constraints.some(c => c.id === id))).toBe(true);
});
