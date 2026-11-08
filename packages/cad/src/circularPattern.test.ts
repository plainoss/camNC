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
  circularPatternSketchEntities,
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
    const result = circularPatternSketchEntities(source, {
      entityIds: [curve.id],
      count: 5,
      center: { x: 10, y: 15 },
    });
    if (!result.ok) throw new Error(result.message);
    const doc = { ...createCadDocument(), parts: [{ ...part, sketch: result.sketch }] };
    expect(validateCadDocument(doc)).toEqual([]);
    expect(parseCadDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    const solved = await solveCadDocument(doc, { sketchOnly: true });
    expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(solved.sketches[0]!.dof).toBe(baseline.sketches[0]!.dof! + 2);
    expect(solved.diagnostics.filter(d => d.code === 'redundant-constraint')).toEqual([]);
    const sketch = solved.document.parts[0]!.sketch,
      group = sketch.constraints.find(c => c.id === result.patternId)!;
    if (group.type !== 'circularPattern' || curve.type === 'point') throw new Error('missing pattern');
    const master = group.instances.find(i => i.x === 0 && i.y === 0)!,
      map = points(sketch.entities),
      original = sketch.entities.find(e => e.id === master.idMap[curve.id])!;
    if (original.type === 'point') throw new Error('missing source');
    for (const instance of group.instances) {
      const copy = sketch.entities.find(e => e.id === instance.idMap[curve.id])!;
      if (copy.type === 'point') throw new Error('missing copy');
      for (let j = 0; j <= 10; j++) {
        const a = evaluateCurvePoint(original, map, j / 10),
          b = evaluateCurvePoint(copy, map, j / 10 + (type === 'circle' ? instance.x / 5 : 0));
        const angle = (instance.x * Math.PI * 2) / 5;
        expect(b.x).toBeCloseTo(10 + Math.cos(angle) * (a.x - 10) - Math.sin(angle) * (a.y - 15), 6);
        expect(b.y).toBeCloseTo(15 + Math.sin(angle) * (a.x - 10) + Math.cos(angle) * (a.y - 15), 6);
      }
    }
  }
);

it('keeps an open sweep when changing count, exclusions and source ownership through reload', async () => {
  const part = createCadPart();
  part.sketch = addCircle(part.sketch, { x: 30, y: 0, radius: 3, dimensioned: true });
  const source = part.sketch.entities.find(e => e.type === 'circle')!;
  const initial = circularPatternSketchEntities(part.sketch, { entityIds: [source.id], count: 4, angle: 180, closed: false });
  if (!initial.ok) throw new Error(initial.message);
  const group = initial.sketch.constraints.find(c => c.id === initial.patternId)!;
  if (group.type !== 'circularPattern') throw new Error('missing pattern');
  const excluded = group.instances.find(i => i.x === 2)!.idMap[source.id]!;
  let sketch = removeEntity(initial.sketch, excluded);
  sketch = removeEntity(sketch, source.id);
  const loaded = parseCadDocument(JSON.parse(JSON.stringify({ ...createCadDocument(), parts: [{ ...part, sketch }] })));
  const shrink = circularPatternSketchEntities(loaded.parts[0]!.sketch, { patternId: group.id, count: 2 });
  if (!shrink.ok) throw new Error(shrink.message);
  const grow = circularPatternSketchEntities(shrink.sketch, { patternId: group.id, count: 5 });
  if (!grow.ok) throw new Error(grow.message);
  const next = grow.sketch.constraints.find(c => c.id === group.id)!;
  if (next.type !== 'circularPattern') throw new Error('missing group');
  expect(next.angle).toBe(180);
  expect(next.closed).toBe(false);
  expect(grow.sketch.entities.some(e => e.id === excluded || e.id === source.id)).toBe(false);
  const solved = await solveCadDocument({ ...loaded, parts: [{ ...part, sketch: grow.sketch }] }, { sketchOnly: true });
  expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
});
it.each([false, true])('solves a free center between fixed source and copy, and reports an incompatible fixed center (%s)', async fixed => {
  const part = createCadPart();
  part.sketch = addCircle(part.sketch, { x: 10, y: 0, radius: 2 });
  const source = part.sketch.entities.find(e => e.type === 'circle')!;
  if (source.type !== 'circle') throw new Error('missing circle');
  const initial = circularPatternSketchEntities(part.sketch, {
    entityIds: [source.id],
    count: 2,
    angle: 90,
    closed: false,
    center: { x: 5, y: 5 },
  });
  if (!initial.ok) throw new Error(initial.message);
  const group = initial.sketch.constraints.find(c => c.id === initial.patternId)!;
  if (group.type !== 'circularPattern') throw new Error('missing pattern');
  const target = group.instances.find(i => i.x === 1)!.idMap[source.centerId]!;
  initial.sketch.entities = initial.sketch.entities.map(e =>
    e.type !== 'point'
      ? e
      : e.id === source.centerId
        ? { ...e, fixed: true }
        : e.id === target
          ? { ...e, x: 0, y: 10, fixed: true }
          : e.id === group.centerId
            ? { ...e, fixed }
            : e
  );
  const solved = await solveCadDocument({ ...createCadDocument(), parts: [{ ...part, sketch: initial.sketch }] }, { sketchOnly: true });
  expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe(fixed ? 'conflict' : 'solved');
  if (!fixed) {
    const center = solved.document.parts[0]!.sketch.entities.find(e => e.id === group.centerId)!;
    expect(center).toMatchObject({ type: 'point' });
    if (center.type === 'point') {
      expect(center.x).toBeCloseTo(0, 6);
      expect(center.y).toBeCloseTo(0, 6);
    }
  }
});
it('transforms complete circular spline patterns including their center and derived handles', async () => {
  const part = createCadPart();
  part.sketch = addSpline(part.sketch, {
    points: [
      { x: 20, y: 0 },
      { x: 35, y: 5 },
      { x: 45, y: 25 },
    ],
  });
  const source = part.sketch.entities.find(e => e.type === 'spline')!;
  const initial = circularPatternSketchEntities(part.sketch, { entityIds: [source.id], count: 3, center: { x: 10, y: 10 } });
  if (!initial.ok) throw new Error(initial.message);
  const ids = initial.sketch.entities.filter(e => e.type === 'spline').map(e => e.id),
    result = transformSketchEntities(initial.sketch, {
      entityIds: ids,
      copy: true,
      translation: { x: 200, y: 100 },
      angle: 30,
      scale: 1.5,
    });
  if (!result.ok) throw new Error(result.message);
  expect(result.sketch.constraints.filter(c => c.type === 'circularPattern')).toHaveLength(2);
  expect(validateCadDocument({ ...createCadDocument(), parts: [{ ...part, sketch: result.sketch }] })).toEqual([]);
  const solved = await solveCadDocument({ ...createCadDocument(), parts: [{ ...part, sketch: result.sketch }] }, { sketchOnly: true });
  expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document)))).toEqual(solved.document);
});

it('releases copied joins and removes only unused definition centers when exploding a circular pattern', async () => {
  const part = createCadPart();
  part.sketch = addRectangle(part.sketch, { x: 20, y: 10, width: 20, height: 10 });
  const edges = part.sketch.entities.filter(e => e.type === 'line').map(e => e.id);
  const initial = circularPatternSketchEntities(part.sketch, { entityIds: edges, count: 3 });
  if (!initial.ok) throw new Error(initial.message);
  const group = initial.sketch.constraints.find(c => c.id === initial.patternId)!;
  if (group.type !== 'circularPattern') throw new Error('missing pattern');
  const free = removeConstraint(initial.sketch, group.id);
  expect(free.entities.some(e => e.id === group.centerId)).toBe(false);
  const solved = await solveCadDocument({ ...createCadDocument(), parts: [{ ...part, sketch: free }] }, { sketchOnly: true });
  expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  const used = addConstraint(initial.sketch, { type: 'positionX', pointId: group.centerId, value: 0 });
  expect(removeConstraint(used, group.id).entities.some(e => e.id === group.centerId)).toBe(true);
});
