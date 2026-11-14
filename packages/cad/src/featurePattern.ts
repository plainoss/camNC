import { faceIsUnderside, flipUnderside } from './featureModel';
import { CAD_CHORD_TOLERANCE, evaluateCadPart, pointInPolygon, polygonArea } from './geometry';
import { rotateVector, type Vec3 } from './placement';
import { regionInteriorPoint, sketchRegions } from './sketchRegions';
import type { CadCut, CadEntity, CadFaceSketch, CadFeature, CadPart } from './types';

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
 * `along`, a world direction, in the board's own plane, and the same regions cut as deep. Regions are found with the
 * board's outline closing them, as the board's own cuts are, so a dado running off an edge repeats too. An instance
 * whose region isn't wholly on the board, a direction out of the face's plane, or a circular pattern, isn't cut.
 */
export function patternedRemoval(
  step: CadPart,
  board: CadPart,
  face: CadFaceSketch,
  cuts: readonly CadCut[],
  along: Vec3 | null
): CadFeature[] {
  const pattern = step.pattern;
  if (!pattern || pattern.suppressed || pattern.circular || pattern.count < 2 || !along) return [];
  const local = board.placement ? rotateVector(conjugate(board.placement.rotation), along) : along;
  if (Math.abs(local[2]) > 1e-6) return [];
  // An underside sketch is seen from below, so its x runs the other way.
  const underside = faceIsUnderside(board, face.on);
  const outline = evaluateCadPart(board).part?.outline;
  if (!outline) return [];
  const boundary = { id: `${board.id}:outline`, points: underside ? flipUnderside(outline) : outline };
  const regionsOf = (sketch: CadFaceSketch['sketch']) => sketchRegions(sketch, CAD_CHORD_TOLERANCE, { boundary });
  const ids = new Set(face.sketch.entities.map(entity => entity.id));
  const regions = regionsOf(face.sketch);
  const made: CadFeature[] = [];
  for (let k = 1; k < pattern.count; k++) {
    if (pattern.excluded?.includes(k)) continue;
    const dx = (underside ? -1 : 1) * local[0] * pattern.spacing * k,
      dy = local[1] * pattern.spacing * k,
      suffix = `~${k}`;
    const sketch = {
      ...face.sketch,
      id: `${face.sketch.id}${suffix}`,
      entities: face.sketch.entities.map(entity => movedEntity(entity, ids, suffix, dx, dy)),
      constraints: [],
    };
    const moved = regionsOf(sketch);
    const instance: CadFeature[] = [{ ...face, id: `${face.id}${suffix}`, sketch }];
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
      // Off the board, the instance isn't cut at all, rather than in part.
      if (!match) {
        instance.length = 0;
        break;
      }
      instance.push({ ...cut, id: `${cut.id}${suffix}`, sketchId: sketch.id, regionId: match.id });
    }
    made.push(...instance);
  }
  return made;
}
