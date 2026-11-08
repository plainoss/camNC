import { expect, it } from 'vitest';
import {
  addLine,
  addArc,
  addCircle,
  addRectangle,
  addConstraint,
  createCadPart,
  createCadDocument,
  slotSketchEntities,
  solveCadDocument,
  parseCadDocument,
  validateCadDocument,
  updateDimension,
  evaluateCadPart,
  removeEntity,
  removeConstraint,
  reconcileSlot,
} from './index';
it.each(['line', 'arc', 'circle', 'chain', 'closed', 'tangent'] as const)(
  'creates a linked %s slot with a diameter width and no extra freedoms',
  async kind => {
    const part = createCadPart();
    let source = part.sketch;
    if (kind === 'arc') source = addArc(source, { cx: 40, cy: 40, radius: 20, startAngle: 0, endAngle: Math.PI * 1.5 });
    else if (kind === 'circle') source = addCircle(source, { x: 40, y: 40, radius: 20 });
    else if (kind === 'closed') source = addRectangle(source, { x: 20, y: 20, width: 60, height: 40 });
    else {
      source = addLine(source, { x1: 20, y1: 20, x2: 70, y2: 20 });
      if (kind === 'chain') source = addLine(source, { x1: 70, y1: 20, x2: 70, y2: 60 });
      if (kind === 'tangent') source = addArc(source, { cx: 70, cy: 40, radius: 20, startAngle: -Math.PI / 2, endAngle: Math.PI / 2 });
    }
    if (kind === 'tangent') {
      const line = source.entities.find(e => e.type === 'line')!,
        arc = source.entities.find(e => e.type === 'arc')!;
      source = addConstraint(source, { type: 'tangent', entityAId: line.id, entityBId: arc.id });
    }
    const ids = source.entities.filter(e => e.type === 'line' || e.type === 'arc' || e.type === 'circle').map(e => e.id);
    const result = slotSketchEntities(source, { entityIds: ids, width: 8 });
    if (!result.ok) throw new Error(result.message);
    const doc = { ...createCadDocument(), parts: [{ ...part, sketch: result.sketch }] };
    expect(validateCadDocument(doc)).toEqual([]);
    expect(parseCadDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    const baseline = await solveCadDocument({ ...doc, parts: [{ ...part, sketch: source }] }, { sketchOnly: true }),
      solved = await solveCadDocument(doc, { sketchOnly: true });
    expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(solved.sketches[0]!.dof).toBe(baseline.sketches[0]!.dof);
    expect(solved.diagnostics.filter(d => d.code === 'redundant-constraint')).toHaveLength(
      baseline.diagnostics.filter(d => d.code === 'redundant-constraint').length
    );
    expect(evaluateCadPart(solved.document.parts[0]!).part).toBeTruthy();
    const wider = await solveCadDocument(updateDimension(solved.document, result.widthConstraintId, 12), { sketchOnly: true });
    expect(wider.sketches[0]!.status, JSON.stringify(wider.diagnostics)).toBe('solved');
    expect(evaluateCadPart(wider.document.parts[0]!).part).toBeTruthy();
    const group = wider.document.parts[0]!.sketch.constraints.find(c => c.id === result.slotId)!;
    if (group.type !== 'slot') throw new Error('missing slot');
    expect(wider.document.parts[0]!.sketch.entities.find(e => e.id === group.widthEntityId)).toMatchObject({ radius: 6 });
  }
);

it('does not silently constrain a merely tangent free source join', () => {
  let sketch = addLine(createCadPart().sketch, { x1: 20, y1: 20, x2: 70, y2: 20 });
  sketch = addArc(sketch, { cx: 70, cy: 40, radius: 20, startAngle: -Math.PI / 2, endAngle: Math.PI / 2 });
  const result = slotSketchEntities(sketch, {
    entityIds: sketch.entities.filter(e => e.type === 'line' || e.type === 'arc').map(e => e.id),
    width: 8,
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.message).toContain('Tangent or Parallel');
});

it.each(['reverse', 'clockwise'] as const)('retains traversal and source freedom for %s paths', async kind => {
  const part = createCadPart();
  let sketch = part.sketch;
  if (kind === 'reverse') {
    sketch = addLine(sketch, { x1: 70, y1: 20, x2: 20, y2: 20 });
    sketch = addArc(sketch, { cx: 90, cy: 20, radius: 20, startAngle: Math.PI / 2, endAngle: Math.PI });
  } else
    for (const [a, b] of [
      [
        { x: 20, y: 20 },
        { x: 20, y: 60 },
      ],
      [
        { x: 20, y: 60 },
        { x: 80, y: 60 },
      ],
      [
        { x: 80, y: 60 },
        { x: 80, y: 20 },
      ],
      [
        { x: 80, y: 20 },
        { x: 20, y: 20 },
      ],
    ])
      sketch = addLine(sketch, { x1: a!.x, y1: a!.y, x2: b!.x, y2: b!.y });
  const result = slotSketchEntities(sketch, {
    entityIds: sketch.entities.filter(e => e.type === 'line' || e.type === 'arc').map(e => e.id),
    width: 8,
  });
  if (!result.ok) throw new Error(result.message);
  const solved = await solveCadDocument({ ...createCadDocument(), parts: [{ ...part, sketch: result.sketch }] }, { sketchOnly: true });
  expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  expect(evaluateCadPart(solved.document.parts[0]!).part).toBeTruthy();
});
it('retains one shared diameter through reload and deletion, then removes the unused definition when released', async () => {
  const part = createCadPart();
  part.sketch = addLine(part.sketch, { x1: 20, y1: 20, x2: 70, y2: 20 });
  const a = part.sketch.entities.at(-1)!;
  part.sketch = addLine(part.sketch, { x1: 20, y1: 60, x2: 70, y2: 60 });
  const b = part.sketch.entities.at(-1)!;
  const first = slotSketchEntities(part.sketch, { entityIds: [a.id], width: 8 });
  if (!first.ok) throw new Error(first.message);
  const group = first.sketch.constraints.find(c => c.id === first.slotId)!;
  if (group.type !== 'slot') throw new Error('missing slot');
  const second = slotSketchEntities(first.sketch, { entityIds: [b.id], width: 8, sharedWidthEntityId: group.widthEntityId });
  if (!second.ok) throw new Error(second.message);
  const doc = parseCadDocument(JSON.parse(JSON.stringify({ ...createCadDocument(), parts: [{ ...part, sketch: second.sketch }] })));
  const deleted = removeEntity(doc.parts[0]!.sketch, a.id);
  expect(deleted.constraints.some(c => c.id === second.slotId)).toBe(true);
  expect(deleted.entities.some(e => e.id === group.widthEntityId)).toBe(true);
  const edited = updateDimension({ ...doc, parts: [{ ...part, sketch: deleted }] }, first.widthConstraintId, 12),
    solved = await solveCadDocument(edited, { sketchOnly: true });
  expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  const free = removeConstraint(solved.document.parts[0]!.sketch, second.slotId);
  expect(free.entities.some(e => e.id === group.widthEntityId)).toBe(false);
  expect(free.constraints.some(c => c.id === first.widthConstraintId)).toBe(false);
});
it('rejects generated reservations colliding with original source points before rebuilding', async () => {
  const part = createCadPart();
  part.sketch = addLine(part.sketch, { x1: 20, y1: 20, x2: 70, y2: 20 });
  const line = part.sketch.entities.find(e => e.type === 'line')!;
  if (line.type !== 'line') throw new Error('missing line');
  const result = slotSketchEntities(part.sketch, { entityIds: [line.id], width: 8 });
  if (!result.ok) throw new Error(result.message);
  const slot = result.sketch.constraints.find(c => c.id === result.slotId)!;
  if (slot.type !== 'slot') throw new Error('missing slot');
  const key = Object.keys(slot.idMap).find(key => result.sketch.entities.find(e => e.id === slot.idMap[key])?.type === 'point')!;
  const old = slot.idMap[key]!;
  slot.idMap[key] = line.startId;
  slot.generatedIds = slot.generatedIds.map(id => (id === old ? line.startId : id));
  const before = structuredClone(result.sketch.entities.find(e => e.id === line.startId));
  const solved = await solveCadDocument({ ...createCadDocument(), parts: [{ ...part, sketch: result.sketch }] }, { sketchOnly: true });
  expect(solved.status).toBe('invalid');
  expect(solved.document.parts[0]!.sketch.entities.find(e => e.id === line.startId)).toEqual(before);
});

it('rejects a source edit that changes its join topology without mutating the saved graph', () => {
  const part = createCadPart();
  part.sketch = addLine(part.sketch, { x1: 20, y1: 20, x2: 70, y2: 20 });
  part.sketch = addLine(part.sketch, { x1: 70, y1: 20, x2: 70, y2: 60 });
  const lines = part.sketch.entities.filter(e => e.type === 'line');
  const result = slotSketchEntities(part.sketch, { entityIds: lines.map(e => e.id), width: 8 });
  if (!result.ok) throw new Error(result.message);
  const group = result.sketch.constraints.find(c => c.id === result.slotId)!;
  if (group.type !== 'slot') throw new Error('missing slot');
  const edited = {
      ...result.sketch,
      entities: result.sketch.entities.map(e => (e.type === 'point' && e.id === lines[1]!.endId ? { ...e, y: -20 } : e)),
    },
    before = structuredClone(edited);
  expect(reconcileSlot(edited, group).ok).toBe(false);
  expect(edited).toEqual(before);
});
