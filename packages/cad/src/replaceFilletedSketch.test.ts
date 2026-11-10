import { describe, expect, it } from 'vitest';
import {
  addCenterRectangle,
  addRectangle,
  addLine,
  addCircle,
  CAD_CHORD_TOLERANCE,
  createCadDocument,
  createCadPart,
  filletLineCorners,
  parseCadDocument,
  polygonArea,
  replaceFilletedSketch,
  sketchRegions,
  solveCadDocument,
} from './index';

function fixture() {
  const part = createCadPart();
  part.sketch = addRectangle(part.sketch, { x: 0, y: 0, width: 400, height: 500, dimensioned: true, positioned: true });
  for (const y of [100, 250, 400])
    part.sketch = addCenterRectangle(part.sketch, { x: 100, y, width: 80, height: 60, dimensioned: true, positioned: true });
  const regions = sketchRegions(part.sketch, CAD_CHORD_TOLERANCE);
  const outer = regions.find(region => region.holes.length === 3)!;
  const islands = regions.filter(region => region !== outer).sort((a, b) => a.points[0]!.y - b.points[0]!.y);
  part.regions = [outer.id, islands[0]!.id, islands[1]!.id];
  return { document: { ...createCadDocument(), parts: [part] }, outer, islands };
}

describe('fillet region references', () => {
  it.each([0, 1, 2, 3])('retains the chosen material when filleting boundary %s, including the unselected island', async index => {
    const { document, outer, islands } = fixture();
    const part = document.parts[0]!;
    const before = structuredClone(document);
    const region = [outer, ...islands][index]!;
    const edge = part.sketch.entities.find(entity => entity.type === 'line' && region.curveIds.includes(entity.id))!;
    if (edge.type !== 'line') throw new Error('missing edge');
    const result = filletLineCorners(part.sketch, { cornerPointIds: [edge.startId], radius: 10 });
    if (!result.ok) throw new Error(result.message);
    const changed = replaceFilletedSketch(document, result.sketch, result.arcIds);
    expect(document).toEqual(before);
    const solved = await solveCadDocument(changed);
    expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(solved.parts[0]!.holes).toHaveLength(1);
    const selected = sketchRegions(solved.document.parts[0]!.sketch, CAD_CHORD_TOLERANCE).filter(region =>
      solved.document.parts[0]!.regions!.includes(region.id)
    );
    expect(selected).toHaveLength(3);
    // Only the outer corner or the remaining hole changes occupied area.
    const removed = 100 - 25 * Math.PI;
    const area =
      Math.abs(polygonArea(solved.parts[0]!.outline)) - solved.parts[0]!.holes.reduce((sum, hole) => sum + Math.abs(polygonArea(hole)), 0);
    expect(area).toBeCloseTo(200000 - 4800 + (index === 0 ? -removed : index === 3 ? removed : 0), 0);
    expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document)))).toEqual(solved.document);
  });

  it('updates shared extrudes and added regions without healing an already missing selection', () => {
    const { document, islands } = fixture();
    const part = document.parts[0]!;
    const shared = {
      ...structuredClone(part),
      id: 'shared',
      sketchOf: part.id,
      regions: [islands[0]!.id],
      addedRegions: [islands[1]!.id, 'missing'],
    };
    document.parts.push(shared);
    part.features = [{ id: 'pocket', type: 'cut', sketchId: part.sketch.id, regionId: islands[0]!.id, depth: 5 }];
    const corners = part.sketch.entities.flatMap(entity => (entity.type === 'line' && !entity.construction ? [entity.startId] : []));
    const result = filletLineCorners(part.sketch, { cornerPointIds: corners, radius: 10 });
    if (!result.ok) throw new Error(result.message);
    const changed = replaceFilletedSketch(document, result.sketch, result.arcIds);
    const regions = sketchRegions(result.sketch, CAD_CHORD_TOLERANCE);
    expect(changed.parts[1]!.regions![0]).not.toBe(shared.regions[0]);
    expect(regions.some(region => region.id === changed.parts[1]!.regions![0])).toBe(true);
    expect(regions.some(region => region.id === changed.parts[1]!.addedRegions![0])).toBe(true);
    expect(changed.parts[1]!.addedRegions![1]).toBe('missing');
    expect(changed.parts[0]!.features).toEqual([{ ...part.features[0], regionId: changed.parts[1]!.regions![0] }]);
  });
  it('does not guess between faces that share their bounding curves', () => {
    const part = createCadPart();
    part.sketch = addLine(part.sketch, { x1: 0, y1: 0, x2: 40, y2: 0 });
    part.sketch = addLine(part.sketch, { x1: 0, y1: 0, x2: 0, y2: 40 });
    part.sketch = addCircle(part.sketch, { x: 10, y: 10, radius: 15 });
    const regions = sketchRegions(part.sketch, CAD_CHORD_TOLERANCE);
    expect(regions).toHaveLength(2);
    expect([...regions[0]!.curveIds].sort()).toEqual([...regions[1]!.curveIds].sort());
    part.regions = regions.map(region => region.id);
    const edge = part.sketch.entities.find(entity => entity.type === 'line')!;
    const fillet = filletLineCorners(part.sketch, { cornerPointIds: [edge.startId], radius: 10 });
    if (!fillet.ok) throw new Error(fillet.message);
    const changed = replaceFilletedSketch({ ...createCadDocument(), parts: [part] }, fillet.sketch, fillet.arcIds);
    expect(changed.parts[0]!.regions).toEqual(part.regions);
  });
});
