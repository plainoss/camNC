import { expect, it } from 'vitest';
import {
  addLine,
  addArc,
  addBezier,
  addCircle,
  addConic,
  addEllipse,
  addSpline,
  addInscribedPolygon,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  evaluateCurvePoint,
  parseCadDocument,
  pointEquivalence,
  solveCadDocument,
  transformSketchEntities,
  validateCadDocument,
  type CadEntity,
  type CadPointEntity,
} from './index';
const points = (entities: CadEntity[]) => new Map(entities.filter((e): e is CadPointEntity => e.type === 'point').map(e => [e.id, e]));
it.each([0, 37, 90, 180, 270])(
  'transforms a dimensioned plate at %s degrees while preserving its scaled shape and releasing absolute location',
  async angle => {
    const doc = createPlateDocument({ width: 120, height: 80 }),
      source = structuredClone(doc.parts[0]!.sketch);
    const ids = source.entities.filter(e => e.type === 'line').map(e => e.id);
    const result = transformSketchEntities(source, { entityIds: ids, translation: { x: 200, y: 200 }, angle, scale: 1.5 });
    if (!result.ok) throw new Error(result.message);
    doc.parts[0]!.sketch = result.sketch;
    expect(validateCadDocument(doc)).toEqual([]);
    const solved = await solveCadDocument(doc);
    expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    const p = points(solved.document.parts[0]!.sketch.entities),
      old = points(source.entities);
    for (const id of ids) {
      const before = source.entities.find(e => e.id === id)!;
      const after = solved.document.parts[0]!.sketch.entities.find(e => e.id === id)!;
      if (before.type !== 'line' || after.type !== 'line') throw new Error('missing edge');
      const a = p.get(after.startId)!,
        b = p.get(after.endId)!,
        u = old.get(before.startId)!,
        v = old.get(before.endId)!;
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(Math.hypot(u.x - v.x, u.y - v.y) * 1.5, 6);
      const r = (angle * Math.PI) / 180;
      expect(a.x).toBeCloseTo(200 + 1.5 * (u.x * Math.cos(r) - u.y * Math.sin(r)), 6);
      expect(a.y).toBeCloseTo(200 + 1.5 * (u.x * Math.sin(r) + u.y * Math.cos(r)), 6);
    }
    expect(p.get(source.entities[0]!.id)).toEqual(source.entities[0]);
    expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document)))).toEqual(solved.document);
  }
);
it.each(['circle', 'arc', 'bezier', 'spline', 'conic', 'ellipse'] as const)(
  'copies exact %s geometry with independent source IDs',
  async type => {
    const part = createCadPart();
    const input = part.sketch;
    part.sketch =
      type === 'circle'
        ? addCircle(input, { x: 50, y: 50, radius: 20 })
        : type === 'arc'
          ? addArc(input, { cx: 50, cy: 50, radius: 20, startAngle: 5.5, endAngle: 2.2 })
          : type === 'ellipse'
            ? addEllipse(input, { center: { x: 50, y: 50 }, axis: { x: 80, y: 65 }, through: { x: 44, y: 62 } })
            : type === 'conic'
              ? addConic(input, { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, control: { x: 40, y: 70 }, rho: 0.7 })
              : type === 'bezier'
                ? addBezier(input, {
                    points: [
                      { x: 0, y: 0 },
                      { x: 20, y: 80 },
                      { x: 70, y: -10 },
                      { x: 100, y: 20 },
                    ],
                  })
                : addSpline(input, {
                    points: [
                      { x: 0, y: 0 },
                      { x: 20, y: 80 },
                      { x: 70, y: -10 },
                      { x: 100, y: 20 },
                    ],
                  });
    const source = part.sketch,
      curve = source.entities.find(e => e.type === type)!;
    const before = structuredClone(source),
      translation = { x: 250, y: 150 },
      pivot = { x: 20, y: 30 },
      angle = 37,
      scale = 1.7;
    const result = transformSketchEntities(source, { entityIds: [curve.id], translation, pivot, angle, scale, copy: true });
    if (!result.ok) throw new Error(result.message);
    expect(source).toEqual(before);
    for (const entity of source.entities) expect(result.sketch.entities).toContainEqual(entity);
    const doc = { ...createCadDocument(), parts: [{ ...part, sketch: result.sketch }] };
    expect(validateCadDocument(doc)).toEqual([]);
    const solved = await solveCadDocument(doc, { sketchOnly: true });
    expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    const copy = solved.document.parts[0]!.sketch.entities.find(e => e.id === result.entityIds[0])!;
    if (curve.type === 'point' || copy.type === 'point') throw new Error('missing curve');
    const old = points(source.entities),
      map = points(solved.document.parts[0]!.sketch.entities),
      r = (angle * Math.PI) / 180;
    for (let i = 0; i <= 20; i++) {
      const a = evaluateCurvePoint(curve, old, i / 20),
        b = evaluateCurvePoint(copy, map, i / 20 + (type === 'circle' ? angle / 360 : 0));
      const x = pivot.x + scale * ((a.x - pivot.x) * Math.cos(r) - (a.y - pivot.y) * Math.sin(r)) + translation.x;
      const y = pivot.y + scale * ((a.x - pivot.x) * Math.sin(r) + (a.y - pivot.y) * Math.cos(r)) + translation.y;
      expect(Math.hypot(b.x - x, b.y - y)).toBeLessThan(1e-6);
    }
  }
);
it('copies a polygon with its hidden definition circle and remaps its complete regularity group', async () => {
  const part = createCadPart();
  part.sketch = addInscribedPolygon(part.sketch, { center: { x: 60, y: 60 }, point: { x: 90, y: 60 }, sides: 5 });
  const ids = part.sketch.entities.filter(e => e.type === 'line').map(e => e.id);
  const result = transformSketchEntities(part.sketch, { entityIds: ids, translation: { x: 200, y: 0 }, copy: true, scale: 2 });
  if (!result.ok) throw new Error(result.message);
  const groups = result.sketch.constraints.filter(c => c.type === 'regularPolygon');
  expect(groups).toHaveLength(2);
  const first = groups[0]!,
    second = groups[1]!;
  expect(second.circleId).not.toBe(first.circleId);
  expect(second.edgeIds.every(id => result.entityIds.includes(id))).toBe(true);
  const solved = await solveCadDocument({ ...createCadDocument(), parts: [{ ...part, sketch: result.sketch }] }, { sketchOnly: true });
  expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
});
it('leaves no-op transforms unchanged and rejects invalid scales without mutating source', () => {
  const source = createPlateDocument().parts[0]!.sketch,
    ids = source.entities.filter(e => e.type === 'line').map(e => e.id),
    before = structuredClone(source);
  const noop = transformSketchEntities(source, { entityIds: ids, angle: 360 });
  if (!noop.ok) throw new Error(noop.message);
  expect(noop.changed).toBe(false);
  expect(noop.sketch).toBe(source);
  for (const scale of [0, -1, NaN, Infinity]) expect(transformSketchEntities(source, { entityIds: ids, scale }).ok).toBe(false);
  expect(source).toEqual(before);
});
it('detaches a selected edge from shared origin/aliases while leaving unselected geometry and its constraints unchanged', async () => {
  const doc = createPlateDocument({ width: 120, height: 80 }),
    source = doc.parts[0]!.sketch;
  const edge = source.entities.find(e => e.type === 'line')!;
  const untouched = source.entities.filter(e => e.type === 'line' && e.id !== edge.id);
  const result = transformSketchEntities(source, { entityIds: [edge.id], translation: { x: 30, y: 20 } });
  if (!result.ok) throw new Error(result.message);
  for (const line of untouched) {
    expect(result.sketch.entities.find(e => e.id === line.id)).toEqual(line);
    if (line.type === 'line')
      for (const id of [line.startId, line.endId])
        expect(result.sketch.entities.find(e => e.id === id)).toEqual(source.entities.find(e => e.id === id));
  }
  expect(result.releasedConstraintIds.length).toBeGreaterThan(0);
  expect(validateCadDocument({ ...doc, parts: [{ ...doc.parts[0]!, sketch: result.sketch }] })).toEqual([]);
});
it('clears signed dimension expressions on rotation and scaled length expressions while preserving exact transformed positions', async () => {
  const part = createCadPart();
  part.sketch = addArc(part.sketch, { cx: 40, cy: 50, radius: 20, startAngle: 0, endAngle: Math.PI });
  const arc = part.sketch.entities.find(e => e.type === 'arc')!;
  part.sketch.constraints.push({
    id: 'signed-span',
    type: 'distanceX',
    pointAId: arc.startId,
    pointBId: arc.endId,
    value: -40,
    expression: '-40 mm',
  });
  const result = transformSketchEntities(part.sketch, { entityIds: [arc.id], angle: 90, translation: { x: 100, y: 0 } });
  if (!result.ok) throw new Error(result.message);
  expect(result.sketch.constraints.find(c => c.id === 'signed-span')).toMatchObject({ type: 'distance', value: 40 });
  expect(result.sketch.constraints.find(c => c.id === 'signed-span')).not.toHaveProperty('expression');
  const solved = await solveCadDocument({ ...createCadDocument(), parts: [{ ...part, sketch: result.sketch }] }, { sketchOnly: true });
  expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  const after = solved.document.parts[0]!.sketch.entities.find(e => e.id === arc.centerId) as CadPointEntity;
  expect(after.x).toBeCloseTo(50, 6);
  expect(after.y).toBeCloseTo(40, 6);
  const circlePart = createCadPart();
  circlePart.sketch = addCircle(circlePart.sketch, { x: 40, y: 50, radius: 20, dimensioned: true });
  const circle = circlePart.sketch.entities.find(e => e.type === 'circle')!;
  const dimension = circlePart.sketch.constraints.find(c => c.type === 'diameter')!;
  if (!('expression' in dimension)) Object.assign(dimension, { expression: '40 mm' });
  const copy = transformSketchEntities(circlePart.sketch, { entityIds: [circle.id], copy: true, scale: 2 });
  if (!copy.ok) throw new Error(copy.message);
  const resized = copy.sketch.constraints.find(c => c.type === 'diameter' && c.entityId === copy.entityIds[0]);
  expect(resized).toMatchObject({ value: 80 });
  expect(resized).not.toHaveProperty('expression');
});
it('rejects radius overflow and sub-tolerance scaling even when the center remains finite', () => {
  const part = createCadPart();
  part.sketch = addCircle(part.sketch, { x: 0, y: 0, radius: 20 });
  const circle = part.sketch.entities.find(e => e.type === 'circle')!;
  expect(transformSketchEntities(part.sketch, { entityIds: [circle.id], scale: 1e308 }).ok).toBe(false);
  expect(transformSketchEntities(part.sketch, { entityIds: [circle.id], scale: 2e-8 }).ok).toBe(false);
});
it.each([false, true])('preserves selected coincidence connectivity through an unselected alias (copy=%s)', async copy => {
  const part = createCadPart();
  const sketch = part.sketch;
  sketch.entities.push(
    { id: 'a', type: 'point', x: 20, y: 0 },
    { id: 'b', type: 'point', x: 20, y: 0 },
    { id: 'left', type: 'point', x: -20, y: 0 },
    { id: 'top', type: 'point', x: 20, y: 40 },
    { id: 'outside', type: 'point', x: 20, y: 0, fixed: true, standalone: true },
    { id: 'first', type: 'line', startId: 'left', endId: 'a' },
    { id: 'second', type: 'line', startId: 'b', endId: 'top' }
  );
  sketch.constraints.push(
    { id: 'outside-a', type: 'coincident', pointAId: 'a', pointBId: 'outside' },
    { id: 'outside-b', type: 'coincident', pointAId: 'outside', pointBId: 'b' }
  );
  const outside = sketch.entities.find(e => e.id === 'outside');
  const result = transformSketchEntities(sketch, { entityIds: ['first', 'second'], translation: { x: 100, y: 100 }, copy });
  if (!result.ok) throw new Error(result.message);
  expect(result.sketch.entities.find(e => e.id === 'outside')).toEqual(outside);
  const equivalent = pointEquivalence(result.sketch.constraints);
  expect(equivalent.equivalent(result.idMap.get('a')!, result.idMap.get('b')!)).toBe(true);
  expect(equivalent.equivalent(result.idMap.get('a')!, 'outside')).toBe(false);
  const solved = await solveCadDocument({ ...createCadDocument(), parts: [{ ...part, sketch: result.sketch }] }, { sketchOnly: true });
  expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
});
it('clones a shared origin endpoint without moving the actual origin or fixing the detached geometry', () => {
  const part = createCadPart();
  part.sketch = addLine(part.sketch, { x1: 0, y1: 0, x2: 40, y2: 0 });
  part.sketch = addLine(part.sketch, { x1: 0, y1: 0, x2: 0, y2: 40 });
  const origin = part.sketch.entities[0]!,
    ids = part.sketch.entities.filter(e => e.type === 'line').map(e => e.id);
  const result = transformSketchEntities(part.sketch, { entityIds: ids, translation: { x: 100, y: 100 } });
  if (!result.ok) throw new Error(result.message);
  expect(result.sketch.entities.find(e => e.id === origin.id)).toEqual(origin);
  const moved = result.sketch.entities.find(e => e.id === result.idMap.get(origin.id)) as CadPointEntity;
  expect(moved.id).not.toBe(origin.id);
  expect(moved).toMatchObject({ x: 100, y: 100 });
  expect(moved.fixed).toBeUndefined();
});
it('remaps a complete curve symmetry group and its axis into a copied selection', async () => {
  const part = createCadPart();
  part.sketch = addCircle(part.sketch, { x: 40, y: 40, radius: 5, dimensioned: true });
  const first = part.sketch.entities.find(e => e.type === 'circle')!;
  part.sketch = addCircle(part.sketch, { x: 80, y: 40, radius: 5 });
  const second = part.sketch.entities.at(-1)!;
  part.sketch = addLine(part.sketch, { x1: 60, y1: 0, x2: 60, y2: 80, construction: true });
  const axis = part.sketch.entities.at(-1)!;
  part.sketch.constraints.push({ id: 'reflection', type: 'symmetricCurves', entityAId: first.id, entityBId: second.id, lineId: axis.id });
  const result = transformSketchEntities(part.sketch, {
    entityIds: [first.id, second.id, axis.id],
    translation: { x: 200, y: 50 },
    angle: 37,
    scale: 2,
    copy: true,
  });
  if (!result.ok) throw new Error(result.message);
  const relation = result.sketch.constraints.find(c => c.type === 'symmetricCurves' && c.id !== 'reflection');
  expect(relation).toMatchObject({
    entityAId: result.idMap.get(first.id),
    entityBId: result.idMap.get(second.id),
    lineId: result.idMap.get(axis.id),
  });
  const solved = await solveCadDocument({ ...createCadDocument(), parts: [{ ...part, sketch: result.sketch }] }, { sketchOnly: true });
  expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
});
