import { CAD_CHORD_TOLERANCE, polygonArea } from './geometry';
import { sketchRegions, type CadSketchRegion } from './sketchRegions';
import type { CadPoint, CadSketch } from './types';

const key = (point: CadPoint) => `${Math.round(point.x * 1e4)},${Math.round(point.y * 1e4)}`;
const oriented = (points: CadPoint[], ccw: boolean) => (polygonArea(points) > 0 === ccw ? points : [...points].reverse());

/** The corners of a region: those of its outline and of its holes, where the regions inside them touch it. */
const corners = (region: CadSketchRegion) => [...region.points, ...region.holes.flat()].map(key);

/**
 * The corners on the outside of the drawing: those of the boundary pieces no two regions share. A region's outline runs
 * counterclockwise and its holes clockwise, so a piece two regions share, or a hole and the outline of what's in it, is
 * run both ways and drops out.
 */
function outsideCorners(regions: CadSketchRegion[]): Set<string> {
  const pieces = new Map<string, [string, string]>();
  for (const region of regions)
    for (const loop of [oriented(region.points, true), ...region.holes.map(hole => oriented(hole, false))])
      loop.forEach((from, at) => {
        const a = key(from),
          b = key(loop[(at + 1) % loop.length]!);
        if (a === b) return;
        if (!pieces.delete(`${b}>${a}`)) pieces.set(`${a}>${b}`, [a, b]);
      });
  return new Set([...pieces.values()].flat());
}

/**
 * A sketch's regions that are solid when it's extruded as shapes apart. Regions are counted inwards from the outside of
 * the drawing: those touching it are solid, those touching only those are holes, those touching only holes are solid
 * again, and so on. So the inside of a frame or a circle in a panel is a hole, and an island in a hole is solid, however
 * the frame around a hole is cut into pieces: mitred at its corners, or across once. Regions that touch at a corner
 * count as touching, so the pieces of overlapping shapes are all solid: where the shapes cross, their overlap touches
 * the outside.
 */
export function solidSketchRegionIds(sketch: CadSketch): string[] {
  const regions = sketchRegions(sketch, CAD_CHORD_TOLERANCE);
  const at = new Map<string, number[]>();
  regions.forEach((region, index) => {
    for (const corner of new Set(corners(region))) at.set(corner, [...(at.get(corner) ?? []), index]);
  });
  const depth = new Array<number>(regions.length).fill(0);
  const outside = outsideCorners(regions);
  let ring = regions.flatMap((region, index) => (corners(region).some(corner => outside.has(corner)) ? [index] : []));
  for (let level = 1; ring.length; level++) {
    for (const index of ring) depth[index] = level;
    const next = new Set<number>();
    for (const index of ring)
      for (const corner of corners(regions[index]!)) for (const other of at.get(corner)!) if (!depth[other]) next.add(other);
    ring = [...next];
  }
  return regions.filter((_, index) => depth[index]! % 2 === 1).map(region => region.id);
}
