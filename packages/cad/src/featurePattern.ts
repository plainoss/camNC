import { CAD_CHORD_TOLERANCE, pointInPolygon, polygonArea } from './geometry';
import { rotateVector, type Vec3 } from './placement';
import { regionInteriorPoint, sketchRegions } from './sketchRegions';
import type { CadCut, CadEntity, CadFaceSketch, CadFeature, CadPart, CadPartPattern, CadPlacement } from './types';

const kAxes: Record<CadPartPattern['axis'], Vec3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const conjugate = ([x, y, z, w]: readonly number[]) => [-x!, -y!, -z!, w!];

/** A sketch entity moved by (dx, dy), its IDs, and the IDs it uses, followed by `suffix`. */
function movedEntity(entity: CadEntity, ids: ReadonlySet<string>, suffix: string, dx: number, dy: number): CadEntity {
  const walk = (value: unknown, key?: string): unknown => {
    if (typeof value === 'string') return ids.has(value) ? `${value}${suffix}` : value;
    if (Array.isArray(value)) return value.map(item => walk(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, k)]));
    if (typeof value === 'number' && (key === 'x' || key === 'y')) return value + (key === 'x' ? dx : dy);
    return value;
  };
  return walk(entity) as CadEntity;
}

/**
 * A Remove step's cuts repeated as its linear feature pattern lays them out: each instance its face sketch moved along
 * the pattern's direction in the board's own x and y, and the same regions cut as deep. A direction out of the face's
 * plane, or a circular pattern, repeats nothing.
 */
export function patternedRemoval(
  step: CadPart,
  board: { placement?: CadPlacement },
  face: CadFaceSketch,
  cuts: readonly CadCut[]
): CadFeature[] {
  const pattern = step.pattern;
  if (!pattern || pattern.suppressed || pattern.circular || pattern.count < 2) return [];
  const world = pattern.vector ?? kAxes[pattern.axis];
  const local = board.placement ? rotateVector(conjugate(board.placement.rotation), world) : world;
  if (Math.abs(local[2]) > 1e-6) return [];
  const ids = new Set(face.sketch.entities.map(entity => entity.id));
  const regions = sketchRegions(face.sketch, CAD_CHORD_TOLERANCE);
  const made: CadFeature[] = [];
  for (let k = 1; k < pattern.count; k++) {
    if (pattern.excluded?.includes(k)) continue;
    const dx = local[0] * pattern.spacing * k,
      dy = local[1] * pattern.spacing * k,
      suffix = `~${k}`;
    const sketch = {
      ...face.sketch,
      id: `${face.sketch.id}${suffix}`,
      entities: face.sketch.entities.map(entity => movedEntity(entity, ids, suffix, dx, dy)),
      constraints: [],
    };
    const moved = sketchRegions(sketch, CAD_CHORD_TOLERANCE);
    made.push({ ...face, id: `${face.id}${suffix}`, sketch });
    for (const cut of cuts) {
      const region = regions.find(candidate => candidate.id === cut.regionId);
      const inside = region && regionInteriorPoint(region.points);
      if (!region || !inside) continue;
      const at = { x: inside.x + dx, y: inside.y + dy };
      const area = Math.abs(polygonArea(region.points));
      const match = moved.find(
        candidate =>
          pointInPolygon(at, candidate.points) && Math.abs(Math.abs(polygonArea(candidate.points)) - area) < 1e-6 * Math.max(1, area)
      );
      if (match) made.push({ ...cut, id: `${cut.id}${suffix}`, sketchId: sketch.id, regionId: match.id });
    }
  }
  return made;
}
