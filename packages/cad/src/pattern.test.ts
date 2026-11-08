import { expect, it } from 'vitest';
import {
  addRectangle,
  removeConstraint,
  filletLineCorners,
  addLine,
  transformSketchEntities,
  removeEntity,
  setSketchConstruction,
  addConstraint,
  updateDimension,
  insertCurveControlPoint,
  addArc,
  addBezier,
  addCircle,
  addConic,
  addEllipse,
  addSpline,
  createCadDocument,
  createCadPart,
  evaluateCurvePoint,
  linearPatternSketchEntities,
  parseCadDocument,
  solveCadDocument,
  validateCadDocument,
  type CadEntity,
  type CadPointEntity,
} from './index';
const points = (entities: CadEntity[]) => new Map(entities.filter((e): e is CadPointEntity => e.type === 'point').map(e => [e.id, e]));
it.each(['circle', 'arc', 'bezier', 'spline', 'conic', 'ellipse'] as const)(
  'links %s copies without adding source freedoms or redundant copied support equations',
  async type => {
    const part = createCadPart(),
      input = part.sketch;
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
    const baseline = await solveCadDocument({ ...createCadDocument(), parts: [part] }, { sketchOnly: true });
    const result = linearPatternSketchEntities(source, {
      entityIds: [curve.id],
      countX: 3,
      countY: 2,
      stepX: { x: 150, y: 20 },
      stepY: { x: -30, y: 120 },
    });
    if (!result.ok) throw new Error(result.message);
    const doc = { ...createCadDocument(), parts: [{ ...part, sketch: result.sketch }] };
    expect(validateCadDocument(doc)).toEqual([]);
    expect(parseCadDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    const solved = await solveCadDocument(doc, { sketchOnly: true });
    expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(solved.sketches[0]!.dof).toBe(baseline.sketches[0]!.dof);
    expect(solved.diagnostics.filter(d => d.code === 'redundant-constraint')).toEqual([]);
    const sketch = solved.document.parts[0]!.sketch,
      group = sketch.constraints.find(c => c.id === result.patternId)!;
    if (group.type !== 'linearPattern' || curve.type === 'point') throw new Error('missing pattern');
    const master = group.instances.find(i => i.x === 0 && i.y === 0)!,
      map = points(sketch.entities),
      original = sketch.entities.find(e => e.id === master.idMap[curve.id])!;
    if (original.type === 'point') throw new Error('missing source');
    for (const instance of group.instances) {
      const copy = sketch.entities.find(e => e.id === instance.idMap[curve.id])!;
      if (copy.type === 'point') throw new Error('missing copy');
      for (let j = 0; j <= 10; j++) {
        const a = evaluateCurvePoint(original, map, j / 10),
          b = evaluateCurvePoint(copy, map, j / 10);
        expect(b.x - a.x).toBeCloseTo(instance.x * 150 - instance.y * 30, 6);
        expect(b.y - a.y).toBeCloseTo(instance.x * 20 + instance.y * 120, 6);
      }
    }
  }
);
it('retains surviving instance IDs across count and spacing edits and rejects duplicate cells', () => {
  const part = createCadPart();
  part.sketch = addCircle(part.sketch, { x: 20, y: 20, radius: 5 });
  const circle = part.sketch.entities.find(e => e.type === 'circle')!;
  const initial = linearPatternSketchEntities(part.sketch, { entityIds: [circle.id], countX: 4, stepX: { x: 40, y: 0 } });
  if (!initial.ok) throw new Error(initial.message);
  const first = initial.sketch.constraints.find(c => c.id === initial.patternId)!;
  if (first.type !== 'linearPattern') throw new Error('missing group');
  const ids = first.instances.map(i => i.idMap[circle.id]);
  const shrink = linearPatternSketchEntities(initial.sketch, { patternId: first.id, countX: 2, stepX: { x: 30, y: 10 } });
  if (!shrink.ok) throw new Error(shrink.message);
  const regrow = linearPatternSketchEntities(shrink.sketch, { patternId: first.id, countX: 4, stepX: { x: 30, y: 10 } });
  if (!regrow.ok) throw new Error(regrow.message);
  const group = regrow.sketch.constraints.find(c => c.id === first.id)!;
  if (group.type !== 'linearPattern') throw new Error('missing group');
  expect(group.instances.map(i => i.idMap[circle.id])).toEqual(ids);
  expect(linearPatternSketchEntities(part.sketch, { entityIds: [circle.id], countX: 3, stepX: { x: 0, y: 0 } }).ok).toBe(false);
});
it.each([false, true])('keeps patterned ellipse axis crossings coherent from source or replica dimensions (replica=%s)', async replica => {
  const part = createCadPart();
  part.sketch = addEllipse(part.sketch, { center: { x: 50, y: 50 }, axis: { x: 80, y: 50 }, through: { x: 50, y: 60 } });
  const source = part.sketch.entities.find(e => e.type === 'ellipse')!;
  const pattern = linearPatternSketchEntities(part.sketch, { entityIds: [source.id], countX: 2, stepX: { x: 100, y: 0 } });
  if (!pattern.ok) throw new Error(pattern.message);
  const group = pattern.sketch.constraints.find(c => c.id === pattern.patternId)!;
  if (group.type !== 'linearPattern') throw new Error('missing group');
  const id = replica ? group.instances.find(i => i.x === 1)!.idMap[source.id]! : source.id;
  const ellipse = pattern.sketch.entities.find(e => e.id === id)!;
  if (ellipse.type !== 'ellipse') throw new Error('missing ellipse');
  const sketch = addConstraint(pattern.sketch, {
    type: 'distance',
    pointAId: ellipse.minorStartId,
    pointBId: ellipse.minorEndId,
    value: 80,
  });
  const dimension = sketch.constraints.at(-1)!;
  const doc = { ...createCadDocument(), parts: [{ ...part, sketch }] };
  const large = await solveCadDocument(doc, { sketchOnly: true });
  expect(large.sketches[0]!.status, JSON.stringify(large.diagnostics)).toBe('solved');
  const small = await solveCadDocument(updateDimension(large.document, dimension.id, 10), { sketchOnly: true });
  expect(small.sketches[0]!.status, JSON.stringify(small.diagnostics)).toBe('solved');
  for (const solved of [large, small]) {
    const ellipses = solved.document.parts[0]!.sketch.entities.filter(e => e.type === 'ellipse');
    expect(ellipses).toHaveLength(2);
    expect(ellipses[0]!.radius).toBeCloseTo(ellipses[1]!.radius, 6);
    expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document)))).toEqual(solved.document);
  }
});
it('reconciles source knot insertion while retaining copied curve and handle identities', async () => {
  const part = createCadPart();
  part.sketch = addSpline(part.sketch, {
    points: [
      { x: 0, y: 0 },
      { x: 20, y: 80 },
      { x: 70, y: -10 },
      { x: 100, y: 20 },
    ],
  });
  const source = part.sketch.entities.find(e => e.type === 'spline')!;
  const initial = linearPatternSketchEntities(part.sketch, { entityIds: [source.id], countX: 3, stepX: { x: 150, y: 20 } });
  if (!initial.ok) throw new Error(initial.message);
  const group = initial.sketch.constraints.find(c => c.id === initial.patternId)!;
  if (group.type !== 'linearPattern') throw new Error('missing group');
  const copyId = group.instances.find(i => i.x === 1)!.idMap[source.id]!;
  const inserted = insertCurveControlPoint(initial.sketch, source.id, 0.4);
  const solved = await solveCadDocument({ ...createCadDocument(), parts: [{ ...part, sketch: inserted }] }, { sketchOnly: true });
  expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  const after = solved.document.parts[0]!.sketch,
    copy = after.entities.find(e => e.id === copyId),
    master = after.entities.find(e => e.id === source.id);
  if (copy?.type !== 'spline' || master?.type !== 'spline') throw new Error('missing splines');
  expect(copy.controlPointIds).toHaveLength(master.controlPointIds.length);
  expect(copy.fitPointIds).toHaveLength(master.fitPointIds.length);
  expect(after.entities.some(e => e.id === `${copyId}:handle:start`)).toBe(true);
  expect(() => insertCurveControlPoint(after, copyId, 0.3)).toThrow(/source curve/);
  const map = points(after.entities);
  for (let i = 0; i <= 20; i++) {
    const a = evaluateCurvePoint(master, map, i / 20),
      b = evaluateCurvePoint(copy, map, i / 20);
    expect(b.x - a.x).toBeCloseTo(150, 6);
    expect(b.y - a.y).toBeCloseTo(20, 6);
  }
});
it('rejects colliding inactive reservations before regrowth can create duplicate geometry', () => {
  const part = createCadPart();
  part.sketch = addCircle(part.sketch, { x: 20, y: 20, radius: 5 });
  const circle = part.sketch.entities.find(e => e.type === 'circle')!;
  const initial = linearPatternSketchEntities(part.sketch, { entityIds: [circle.id], countX: 4, stepX: { x: 40, y: 0 } });
  if (!initial.ok) throw new Error(initial.message);
  const shrink = linearPatternSketchEntities(initial.sketch, { patternId: initial.patternId, countX: 2, stepX: { x: 40, y: 0 } });
  if (!shrink.ok) throw new Error(shrink.message);
  const group = shrink.sketch.constraints.find(c => c.id === initial.patternId)!;
  if (group.type !== 'linearPattern') throw new Error('missing group');
  group.instances.find(i => i.x === 3)!.idMap[circle.id] = group.instances.find(i => i.x === 2)!.idMap[circle.id]!;
  const doc = { ...createCadDocument(), parts: [{ ...part, sketch: shrink.sketch }] };
  expect(() => parseCadDocument(JSON.parse(JSON.stringify(doc)))).toThrow(/distinct/);
  expect(linearPatternSketchEntities(shrink.sketch, { patternId: group.id, countX: 4, stepX: { x: 40, y: 0 } }).ok).toBe(false);
});
it('keeps per-entity deletion exclusions across reload, count shrink and regrowth', async () => {
  const part = createCadPart();
  part.sketch = addCircle(part.sketch, { x: 20, y: 20, radius: 5 });
  const a = part.sketch.entities.at(-1)!;
  part.sketch = addCircle(part.sketch, { x: 40, y: 20, radius: 5 });
  const b = part.sketch.entities.at(-1)!;
  const initial = linearPatternSketchEntities(part.sketch, { entityIds: [a.id, b.id], countX: 3, stepX: { x: 100, y: 0 } });
  if (!initial.ok) throw new Error(initial.message);
  const group = initial.sketch.constraints.find(c => c.id === initial.patternId)!;
  if (group.type !== 'linearPattern') throw new Error('missing pattern');
  const cell = group.instances.find(i => i.x === 1)!;
  const deletedId = cell.idMap[a.id]!,
    siblingId = cell.idMap[b.id]!;
  const deleted = removeEntity(initial.sketch, deletedId);
  expect(deleted.entities.some(e => e.id === deletedId)).toBe(false);
  expect(deleted.entities.some(e => e.id === siblingId)).toBe(true);
  const loaded = parseCadDocument(JSON.parse(JSON.stringify({ ...createCadDocument(), parts: [{ ...part, sketch: deleted }] })));
  const shrink = linearPatternSketchEntities(loaded.parts[0]!.sketch, { patternId: group.id, countX: 2, stepX: { x: 100, y: 0 } });
  if (!shrink.ok) throw new Error(shrink.message);
  const regrow = linearPatternSketchEntities(shrink.sketch, { patternId: group.id, countX: 3, stepX: { x: 100, y: 0 } });
  if (!regrow.ok) throw new Error(regrow.message);
  expect(regrow.sketch.entities.some(e => e.id === deletedId)).toBe(false);
  expect(regrow.sketch.entities.some(e => e.id === siblingId)).toBe(true);
  const solved = await solveCadDocument({ ...loaded, parts: [{ ...part, sketch: regrow.sketch }] }, { sketchOnly: true });
  expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
});
it('rebases a deleted seed to a complete surviving instance without moving geometry or renumbering exclusions', async () => {
  const part = createCadPart();
  part.sketch = addCircle(part.sketch, { x: 20, y: 20, radius: 5, dimensioned: true });
  const source = part.sketch.entities.at(-1)!;
  const initial = linearPatternSketchEntities(part.sketch, { entityIds: [source.id], countX: 4, stepX: { x: 40, y: 10 } });
  if (!initial.ok) throw new Error(initial.message);
  const before = structuredClone(initial.sketch),
    deleted = removeEntity(initial.sketch, source.id),
    group = deleted.constraints.find(c => c.id === initial.patternId);
  if (group?.type !== 'linearPattern') throw new Error('missing rebased pattern');
  expect(group.masterX).toBe(1);
  expect(group.exclusions).toContainEqual({ seedKey: source.id, x: 0, y: 0 });
  for (const entity of deleted.entities.filter(e => e.type === 'circle' || (e.type === 'point' && e.id !== part.sketch.entities[0]!.id))) {
    const prior = before.entities.find(e => e.id === entity.id)!;
    expect({ ...prior, construction: !!prior.construction }).toEqual({ ...entity, construction: !!entity.construction });
  }
  expect(deleted.entities.some(e => e.id === source.id)).toBe(false);
  const solved = await solveCadDocument({ ...createCadDocument(), parts: [{ ...part, sketch: deleted }] }, { sketchOnly: true });
  expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document)))).toEqual(solved.document);
});
it('preserves the actual origin when deleting a patterned curve that owned its source endpoint', async () => {
  const part = createCadPart();
  part.sketch = addBezier(part.sketch, {
    points: [
      { x: 0, y: 0 },
      { x: 20, y: 80 },
      { x: 70, y: -10 },
      { x: 100, y: 20 },
    ],
  });
  const source = part.sketch.entities.find(e => e.type === 'bezier')!,
    origin = part.sketch.entities[0]!;
  const initial = linearPatternSketchEntities(part.sketch, { entityIds: [source.id], countX: 3, stepX: { x: 150, y: 20 } });
  if (!initial.ok) throw new Error(initial.message);
  const deleted = removeEntity(initial.sketch, source.id);
  expect(deleted.entities.find(e => e.id === origin.id)).toEqual(origin);
  const solved = await solveCadDocument({ ...createCadDocument(), parts: [{ ...part, sketch: deleted }] }, { sketchOnly: true });
  expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
});
it('dissolves an incomplete master graph only when no complete instance survives', () => {
  const part = createCadPart();
  part.sketch = addCircle(part.sketch, { x: 20, y: 20, radius: 5 });
  const a = part.sketch.entities.at(-1)!;
  part.sketch = addCircle(part.sketch, { x: 40, y: 20, radius: 5 });
  const b = part.sketch.entities.at(-1)!;
  const initial = linearPatternSketchEntities(part.sketch, { entityIds: [a.id, b.id], countX: 2, stepX: { x: 100, y: 0 } });
  if (!initial.ok) throw new Error(initial.message);
  const first = removeEntity(initial.sketch, a.id),
    group = first.constraints.find(c => c.id === initial.patternId);
  if (group?.type !== 'linearPattern') throw new Error('missing pattern');
  const last = removeEntity(first, group.instances.find(i => i.x === 1)!.idMap[b.id]!);
  expect(last.constraints.some(c => c.id === initial.patternId)).toBe(false);
  expect(last.entities.filter(e => e.type === 'circle')).toHaveLength(2);
  expect(validateCadDocument({ ...createCadDocument(), parts: [{ ...part, sketch: last }] })).toEqual([]);
});
it('copies and rotates complete patterns with independent inactive ID reservations', async () => {
  const part = createCadPart();
  part.sketch = addCircle(part.sketch, { x: 20, y: 20, radius: 5, dimensioned: true });
  const circle = part.sketch.entities.at(-1)!;
  const full = linearPatternSketchEntities(part.sketch, { entityIds: [circle.id], countX: 4, stepX: { x: 40, y: 0 } });
  if (!full.ok) throw new Error(full.message);
  const shrink = linearPatternSketchEntities(full.sketch, { patternId: full.patternId, countX: 2, stepX: { x: 40, y: 0 } });
  if (!shrink.ok) throw new Error(shrink.message);
  const ids = shrink.sketch.entities.filter(e => e.type === 'circle').map(e => e.id);
  const copied = transformSketchEntities(shrink.sketch, {
    entityIds: ids,
    copy: true,
    translation: { x: 200, y: 200 },
    angle: 90,
    scale: 2,
  });
  if (!copied.ok) throw new Error(copied.message);
  const groups = copied.sketch.constraints.filter(c => c.type === 'linearPattern');
  expect(groups).toHaveLength(2);
  expect(groups[1]!.stepX.x).toBeCloseTo(0, 6);
  expect(groups[1]!.stepX.y).toBeCloseTo(80, 6);
  const oldIds = new Set(groups[0]!.instances.flatMap(i => Object.values(i.idMap)));
  expect(groups[1]!.instances.flatMap(i => Object.values(i.idMap)).some(id => oldIds.has(id))).toBe(false);
  const regrow = linearPatternSketchEntities(copied.sketch, { patternId: groups[1]!.id, countX: 4, stepX: groups[1]!.stepX });
  if (!regrow.ok) throw new Error(regrow.message);
  const solved = await solveCadDocument({ ...createCadDocument(), parts: [{ ...part, sketch: regrow.sketch }] }, { sketchOnly: true });
  expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  expect(validateCadDocument(solved.document)).toEqual([]);
  expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document)))).toEqual(solved.document);
});
it('retains independent per-instance construction choices through source deletion and count changes', () => {
  const part = createCadPart();
  part.sketch = addCircle(part.sketch, { x: 20, y: 20, radius: 5 });
  const source = part.sketch.entities.at(-1)!;
  const initial = linearPatternSketchEntities(part.sketch, { entityIds: [source.id], countX: 3, stepX: { x: 40, y: 0 } });
  if (!initial.ok) throw new Error(initial.message);
  const group = initial.sketch.constraints.find(c => c.id === initial.patternId)!;
  if (group.type !== 'linearPattern') throw new Error('missing pattern');
  const target = group.instances.find(i => i.x === 2)!.idMap[source.id]!;
  const construction = setSketchConstruction(initial.sketch, [target], true),
    deleted = removeEntity(construction, source.id);
  expect(deleted.entities.find(e => e.id === target)?.construction).toBe(true);
  const shrink = linearPatternSketchEntities(deleted, { patternId: group.id, countX: 2, stepX: { x: 40, y: 0 } });
  if (!shrink.ok) throw new Error(shrink.message);
  const regrow = linearPatternSketchEntities(shrink.sketch, { patternId: group.id, countX: 3, stepX: { x: 40, y: 0 } });
  if (!regrow.ok) throw new Error(regrow.message);
  expect(regrow.sketch.entities.find(e => e.id === target)?.construction).toBe(true);
});
it('detects contradictory fixed target spacing instead of moving a fixed instance during reconciliation', async () => {
  const part = createCadPart();
  part.sketch = addCircle(part.sketch, { x: 20, y: 20, radius: 5 });
  const source = part.sketch.entities.at(-1)!;
  const initial = linearPatternSketchEntities(part.sketch, { entityIds: [source.id], countX: 2, stepX: { x: 40, y: 0 } });
  if (!initial.ok) throw new Error(initial.message);
  initial.sketch.entities = initial.sketch.entities.map(e => (e.type === 'point' ? { ...e, fixed: true } : e));
  const edited = linearPatternSketchEntities(initial.sketch, { patternId: initial.patternId, countX: 2, stepX: { x: 50, y: 0 } });
  if (!edited.ok) throw new Error(edited.message);
  const solved = await solveCadDocument({ ...createCadDocument(), parts: [{ ...part, sketch: edited.sketch }] }, { sketchOnly: true });
  expect(solved.sketches[0]!.status).toBe('conflict');
  expect(solved.diagnostics.some(d => d.constraintIds?.includes(initial.patternId))).toBe(true);
  expect(edited.sketch.entities.filter(e => e.type === 'point').map(e => e.x)).toEqual(
    initial.sketch.entities.filter(e => e.type === 'point').map(e => e.x)
  );
});
it('retains positioning constraints on a deleted seed center still used by unselected geometry', async () => {
  const part = createCadPart();
  part.sketch = addCircle(part.sketch, { x: 20, y: 20, radius: 5 });
  const circle = part.sketch.entities.at(-1)!;
  if (circle.type !== 'circle') throw new Error('missing circle');
  part.sketch = addConstraint(part.sketch, { type: 'positionX', pointId: circle.centerId, value: 20 });
  const x = part.sketch.constraints.at(-1)!;
  part.sketch = addConstraint(part.sketch, { type: 'positionY', pointId: circle.centerId, value: 20 });
  const y = part.sketch.constraints.at(-1)!;
  part.sketch = addLine(part.sketch, { x1: 20, y1: 20, x2: 70, y2: 20 });
  const outside = part.sketch.entities.at(-1)!;
  const initial = linearPatternSketchEntities(part.sketch, { entityIds: [circle.id], countX: 3, stepX: { x: 40, y: 0 } });
  if (!initial.ok) throw new Error(initial.message);
  const deleted = removeEntity(initial.sketch, circle.id);
  expect(deleted.constraints).toContainEqual(x);
  expect(deleted.constraints).toContainEqual(y);
  expect(deleted.entities.find(e => e.id === outside.id)).toEqual(outside);
  const solved = await solveCadDocument({ ...createCadDocument(), parts: [{ ...part, sketch: deleted }] }, { sketchOnly: true });
  expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  expect(solved.document.parts[0]!.sketch.entities.find(e => e.id === circle.centerId)).toMatchObject({ x: 20, y: 20 });
});
it('conditions ellipse crossings driven through aliases of copied axis endpoints', async () => {
  const part = createCadPart();
  part.sketch = addEllipse(part.sketch, { center: { x: 50, y: 50 }, axis: { x: 80, y: 50 }, through: { x: 50, y: 60 } });
  const source = part.sketch.entities.find(e => e.type === 'ellipse')!;
  const initial = linearPatternSketchEntities(part.sketch, { entityIds: [source.id], countX: 2, stepX: { x: 100, y: 0 } });
  if (!initial.ok) throw new Error(initial.message);
  const group = initial.sketch.constraints.find(c => c.id === initial.patternId)!;
  if (group.type !== 'linearPattern') throw new Error('missing group');
  const copy = initial.sketch.entities.find(e => e.id === group.instances.find(i => i.x === 1)!.idMap[source.id])!;
  if (copy.type !== 'ellipse') throw new Error('missing copy');
  const map = points(initial.sketch.entities),
    a = map.get(copy.minorStartId)!,
    b = map.get(copy.minorEndId)!;
  initial.sketch.entities.push({ ...a, id: '0-alias-start', standalone: true }, { ...b, id: '0-alias-end', standalone: true });
  initial.sketch.constraints.push(
    { id: 'alias-start', type: 'coincident', pointAId: a.id, pointBId: '0-alias-start' },
    { id: 'alias-end', type: 'coincident', pointAId: b.id, pointBId: '0-alias-end' },
    { id: 'alias-diameter', type: 'distance', pointAId: '0-alias-start', pointBId: '0-alias-end', value: 80 }
  );
  const large = await solveCadDocument({ ...createCadDocument(), parts: [{ ...part, sketch: initial.sketch }] }, { sketchOnly: true });
  expect(large.sketches[0]!.status, JSON.stringify(large.diagnostics)).toBe('solved');
  const small = await solveCadDocument(updateDimension(large.document, 'alias-diameter', 10), { sketchOnly: true });
  expect(small.sketches[0]!.status, JSON.stringify(small.diagnostics)).toBe('solved');
});

it('keeps closed copied profiles joined after source rebasing and relation removal', async () => {
  const part = createCadPart();
  part.sketch = addRectangle(part.sketch, { x: 20, y: 20, width: 30, height: 20 });
  const edges = part.sketch.entities.filter(e => e.type === 'line').map(e => e.id);
  const initial = linearPatternSketchEntities(part.sketch, { entityIds: edges, countX: 3, stepX: { x: 60, y: 0 } });
  if (!initial.ok) throw new Error(initial.message);
  const solve = async (sketch: typeof part.sketch) =>
    solveCadDocument({ ...createCadDocument(), parts: [{ ...part, sketch }] }, { sketchOnly: true });
  const baseline = await solve(part.sketch),
    linked = await solve(initial.sketch);
  expect(linked.sketches[0]!.status, JSON.stringify(linked.diagnostics)).toBe('solved');
  expect(linked.sketches[0]!.dof).toBe(baseline.sketches[0]!.dof);
  expect(linked.diagnostics.filter(d => d.code === 'redundant-constraint')).toEqual([]);
  let rebased = initial.sketch;
  for (const id of edges) rebased = removeEntity(rebased, id);
  const group = rebased.constraints.find(c => c.id === initial.patternId);
  if (group?.type !== 'linearPattern') throw new Error('missing pattern');
  expect(group.masterX).toBe(1);
  const solved = await solve(rebased);
  expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  const free = removeConstraint(rebased, group.id);
  const detached = await solve(free);
  expect(detached.sketches[0]!.status, JSON.stringify(detached.diagnostics)).toBe('solved');
  const cell = group.instances.find(i => i.x === 2)!;
  const corner = cell.idMap[(part.sketch.entities.find(e => e.id === edges[0]) as import('./types').CadLineEntity).endId]!;
  expect(filletLineCorners(free, { cornerPointIds: [corner], radius: 2 }).ok).toBe(true);
});
it('requires releasing a pattern before transforming only one of its instances', () => {
  const part = createCadPart();
  part.sketch = addCircle(part.sketch, { x: 20, y: 20, radius: 5 });
  const circle = part.sketch.entities.find(e => e.type === 'circle')!;
  const initial = linearPatternSketchEntities(part.sketch, { entityIds: [circle.id], countX: 3, stepX: { x: 40, y: 0 } });
  if (!initial.ok) throw new Error(initial.message);
  expect(transformSketchEntities(initial.sketch, { entityIds: [circle.id], translation: { x: 5, y: 5 } }).ok).toBe(false);
  expect(
    transformSketchEntities(removeConstraint(initial.sketch, initial.patternId), { entityIds: [circle.id], translation: { x: 5, y: 5 } }).ok
  ).toBe(true);
});

it('reports incompatible fixed master joins implied by a coincidence authored on a replica', async () => {
  const part = createCadPart();
  part.sketch = addLine(part.sketch, { x1: 20, y1: 20, x2: 30, y2: 20 });
  const line = part.sketch.entities.find(e => e.type === 'line')!;
  if (line.type !== 'line') throw new Error('missing line');
  part.sketch.entities = part.sketch.entities.map(e => (e.type === 'point' ? { ...e, fixed: true } : e));
  const result = linearPatternSketchEntities(part.sketch, { entityIds: [line.id], countX: 2, stepX: { x: 50, y: 0 } });
  if (!result.ok) throw new Error(result.message);
  const group = result.sketch.constraints.find(c => c.id === result.patternId)!;
  if (group.type !== 'linearPattern') throw new Error('missing group');
  const copy = group.instances.find(i => i.x === 1)!;
  const sketch = addConstraint(result.sketch, {
    type: 'coincident',
    pointAId: copy.idMap[line.startId]!,
    pointBId: copy.idMap[line.endId]!,
  });
  const solved = await solveCadDocument({ ...createCadDocument(), parts: [{ ...part, sketch }] }, { sketchOnly: true });
  expect(solved.sketches[0]!.status).toBe('conflict');
  expect(solved.diagnostics.some(d => d.constraintIds?.includes(group.id))).toBe(true);
});
