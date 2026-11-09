import { CAD_CHORD_TOLERANCE, pointInPolygon, polygonArea } from './geometry';
import { regionInteriorPoint, sketchRegions } from './sketchRegions';
import type { CadSketchRegion } from './sketchRegions';
import type { CadDiagnostic, CadPart, CadSketch, EvaluatedCadPart } from './types';

/**
 * A part extruded from the regions picked in its sketch, as the reference's Extrude takes them: the sketch can hold
 * other lines, crossing or open, and only the picked regions are the part, with those Extrude → Add steps join to it.
 * Regions side by side make one part; their islands are holes. Nothing picked, regions that don't touch, or a region
 * that's gone, as when the lines around it were redrawn, say so.
 */
export function regionProfile(part: CadPart & { regions: string[] }): { part?: EvaluatedCadPart; diagnostics: CadDiagnostic[] } {
  const problem = (code: string, message: string) => ({ diagnostics: [{ code, message, severity: 'error' as const, partId: part.id }] });
  const regions = sketchRegions(part.sketch, CAD_CHORD_TOLERANCE);
  const wanted = [...new Set([...part.regions, ...(part.addedRegions ?? [])])];
  if (!wanted.length) return problem('region-count', 'Pick the regions of the sketch to extrude in the view.');
  const picked = regions.filter(region => wanted.includes(region.id));
  if (picked.length < wanted.length)
    return problem('region-missing', `A region picked for ${part.name} is no longer in its sketch. Pick its regions again.`);
  const region = picked.length === 1 ? picked[0]! : joinedRegions(part.sketch, picked);
  if (!region) return problem('region-count', 'The picked regions don’t touch. Extrude each into a part of its own.');
  // Each island is another region's outline: its curves name the hole, as a whole sketch's loops do, so a pocket set on
  // that loop still finds it.
  const box = (points: { x: number; y: number }[]) =>
    [
      Math.min(...points.map(p => p.x)),
      Math.min(...points.map(p => p.y)),
      Math.max(...points.map(p => p.x)),
      Math.max(...points.map(p => p.y)),
    ]
      .map(value => Math.round(value * 1000))
      .join();
  const holeCurves = (hole: { x: number; y: number }[]) =>
    regions.find(
      candidate =>
        candidate !== region &&
        box(candidate.points) === box(hole) &&
        Math.abs(Math.abs(polygonArea(candidate.points)) - Math.abs(polygonArea(hole))) < 1e-3
    )?.curveIds ?? [];
  return {
    part: {
      partId: part.id,
      name: part.name,
      thickness: part.thickness,
      outline: region.points,
      holes: region.holes,
      loops: [
        {
          id: `${part.id}:profile:${[...region.curveIds].sort().join(':')}`,
          entityIds: region.curveIds,
          points: region.points,
          kind: 'outer',
        },
        ...region.holes.map((points, index) => {
          const entityIds = holeCurves(points);
          return {
            id: entityIds.length ? `${part.id}:profile:${[...entityIds].sort().join(':')}` : `${part.id}:profile:hole${index}`,
            entityIds,
            points,
            kind: 'hole' as const,
          };
        }),
      ],
    },
    diagnostics: [],
  };
}

const regionArea = (region: Pick<CadSketchRegion, 'points' | 'holes'>) =>
  Math.abs(polygonArea(region.points)) - region.holes.reduce((sum, hole) => sum + Math.abs(polygonArea(hole)), 0);

type Point = { x: number; y: number };

/** A point in a region's area: inside its outline and outside its holes. */
function areaPoint(region: CadSketchRegion): Point | null {
  const outline = polygonArea(region.points) > 0 ? region.points : [...region.points].reverse();
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!,
      b = outline[(i + 1) % outline.length]!,
      c = outline[(i + 2) % outline.length]!;
    for (const t of [1 / 3, 0.1, 0.02]) {
      const point = { x: b.x + (a.x + c.x - 2 * b.x) * t, y: b.y + (a.y + c.y - 2 * b.y) * t };
      if (pointInPolygon(point, outline) && !region.holes.some(hole => pointInPolygon(point, hole))) return point;
    }
  }
  return regionInteriorPoint(outline);
}

/**
 * The picked regions put together: the boundary pieces two of them share are left out, and what's left is chained into
 * outlines, each with the holes inside it. Regions side by side, or overlapping shapes' pieces, come out as one outline;
 * regions apart as one each, in the order of their first region.
 */
export function regionGroups(picked: CadSketchRegion[]): { outline: Point[]; holes: Point[][]; regionIds: string[]; curveIds: string[] }[] {
  const key = (point: Point) => `${Math.round(point.x * 1e4)},${Math.round(point.y * 1e4)}`;
  const oriented = (points: Point[], ccw: boolean) => (polygonArea(points) > 0 === ccw ? points : [...points].reverse());
  const segments = new Map<string, { from: Point; to: Point; region: number }>();
  picked.forEach((region, index) => {
    for (const loop of [oriented(region.points, true), ...region.holes.map(hole => oriented(hole, false))])
      loop.forEach((from, at) => {
        const to = loop[(at + 1) % loop.length]!;
        if (key(from) === key(to)) return;
        const back = `${key(to)}>${key(from)}`;
        // A piece two picked regions share is inside what they make together.
        if (segments.has(back)) segments.delete(back);
        else segments.set(`${key(from)}>${key(to)}`, { from, to, region: index });
      });
  });
  const leaving = new Map<string, { from: Point; to: Point; region: number }[]>();
  for (const segment of segments.values()) leaving.set(key(segment.from), [...(leaving.get(key(segment.from)) ?? []), segment]);
  const loops: { points: Point[]; regions: Set<number> }[] = [];
  for (const first of segments.values()) {
    if (!leaving.get(key(first.from))?.includes(first)) continue;
    const points: Point[] = [],
      regions = new Set<number>();
    let segment: typeof first | undefined = first;
    while (segment) {
      const out = leaving.get(key(segment.from))!;
      out.splice(out.indexOf(segment), 1);
      points.push(segment.from);
      regions.add(segment.region);
      if (key(segment.to) === key(first.from)) break;
      segment = leaving.get(key(segment.to))?.[0];
    }
    if (points.length > 2) loops.push({ points, regions });
  }
  const outlines = loops.filter(loop => polygonArea(loop.points) > 0);
  const holes = loops.filter(loop => polygonArea(loop.points) < 0);
  // Every picked region is in the outline around a point inside it; outlines go in the order of their first region.
  const groups = outlines.map(loop => ({
    outline: loop.points,
    holes: [] as Point[][],
    members: [] as number[],
  }));
  for (const hole of holes) {
    const around = groups
      .filter(group => pointInPolygon(hole.points[0]!, group.outline))
      .sort((a, b) => Math.abs(polygonArea(a.outline)) - Math.abs(polygonArea(b.outline)))[0];
    around?.holes.push([...hole.points].reverse());
  }
  // Each picked region is in the group whose area, holes left out, holds a point of its own area.
  picked.forEach((region, index) => {
    const inside = areaPoint(region);
    const group =
      inside &&
      groups.find(candidate => pointInPolygon(inside, candidate.outline) && !candidate.holes.some(hole => pointInPolygon(inside, hole)));
    group?.members.push(index);
  });
  return groups
    .filter(group => group.members.length)
    .sort((a, b) => Math.min(...a.members) - Math.min(...b.members))
    .map(group => ({
      outline: group.outline,
      holes: group.holes,
      regionIds: group.members.map(index => picked[index]!.id),
      curveIds: [...new Set(group.members.flatMap(index => picked[index]!.curveIds))],
    }));
}

/**
 * Regions side by side, or overlapping, as one: their outlines put together, with the holes left inside. Regions that
 * don't touch have none.
 */
export function joinedRegions(_sketch: CadSketch, picked: CadSketchRegion[]): CadSketchRegion | null {
  const groups = regionGroups(picked);
  if (groups.length !== 1 || groups[0]!.regionIds.length !== picked.length) return null;
  const [group] = groups;
  return { id: group!.regionIds.join('+'), curveIds: group!.curveIds, points: group!.outline, holes: group!.holes };
}
