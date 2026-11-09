import { cadFaceFrame } from './drawnOn';
import { isCadPart } from './features';
import type { CadDocument, CadPart, CadPointEntity, CadSketch } from './types';

type Vec3 = [number, number, number];
type Frame = { origin: Vec3; x: Vec3; y: Vec3; normal: Vec3 };

/**
 * Where a corner of a part is in the studio: a point of its sketch, on its top or its bottom. Its sketch's axes come
 * from the plane or face it's drawn on rather than its saved turn, which is kept to nine places: turned through that, a
 * corner 600 mm out lands a micrometre off, enough that an upright edge used from it isn't upright, and a sketch tied
 * to both its ends can't be solved.
 */
function cornerAt(document: CadDocument, part: CadPart, pointId: string, side: 'top' | 'bottom'): Vec3 | null {
  if (part.thin || !part.drawnOn) return null;
  const point = part.sketch.entities.find((entity): entity is CadPointEntity => entity.type === 'point' && entity.id === pointId);
  const frame = cadSketchFrame(document, part);
  if (!point || !frame) return null;
  // Where the sketch's origin is, as the part is placed, which takes in a move by a transform. Its underside sits there.
  const inward = part.drawnOn.inward ? -part.thickness : 0;
  const origin = part.placement?.position ?? frame.origin.map((value, axis) => value + frame.normal[axis]! * inward);
  const up = side === 'top' ? part.thickness : 0;
  return [0, 1, 2].map(axis => origin[axis]! + frame.x[axis]! * point.x + frame.y[axis]! * point.y + frame.normal[axis]! * up) as Vec3;
}

/** A point of the studio seen on a sketch's plane, in that sketch's own mm. */
const onPlane = (frame: Frame, at: Vec3) => {
  const d = [0, 1, 2].map(axis => at[axis]! - frame.origin[axis]!);
  return {
    x: d[0]! * frame.x[0] + d[1]! * frame.x[1] + d[2]! * frame.x[2],
    y: d[0]! * frame.y[0] + d[1]! * frame.y[1] + d[2]! * frame.y[2],
  };
};

/** The plane a part's sketch lies on, in the studio. */
export function cadSketchFrame(document: CadDocument, part: CadPart): Frame | null {
  const frame = cadFaceFrame(document, part.drawnOn?.on ?? { plane: 'top' });
  if ('error' in frame) return null;
  const offset = part.drawnOn?.offset ?? 0;
  return { ...frame, origin: frame.origin.map((value, axis) => value + frame.normal[axis]! * offset) as Vec3 };
}

/**
 * The corners of the other parts, as a sketch on `frame` sees them, so an edge used from the view can be tied to the
 * corners it runs between. Keys are positions rounded to a thousandth of a mm.
 */
export function cadCornerSources(
  document: CadDocument,
  frame: Frame,
  except?: string,
  sourcePartId?: string
): Map<string, NonNullable<CadPointEntity['used']>> {
  const sources = new Map<string, NonNullable<CadPointEntity['used']>>();
  for (const part of document.parts) {
    if (part.id === except || (sourcePartId && part.id !== sourcePartId) || !isCadPart(part) || part.thin || !part.drawnOn) continue;
    for (const entity of part.sketch.entities) {
      if (entity.type !== 'point' || entity.construction) continue;
      for (const side of ['top', 'bottom'] as const) {
        const at = cornerAt(document, part, entity.id, side);
        if (!at) continue;
        const { x, y } = onPlane(frame, at);
        const key = cornerKey(x, y);
        if (!sources.has(key)) sources.set(key, { partId: part.id, pointId: entity.id, side });
      }
    }
  }
  return sources;
}

export const cornerKey = (x: number, y: number) => `${Math.round(x * 1000) / 1000 || 0},${Math.round(y * 1000) / 1000 || 0}`;

/**
 * A part's sketch with its used points where the corners they came from are now, so an edge used from another part
 * follows it. A corner that's gone leaves its point where it was, still fixed.
 */
export function withUsedPoints(document: CadDocument, part: CadPart): CadSketch {
  if (!part.sketch.entities.some(entity => entity.type === 'point' && entity.used)) return part.sketch;
  const frame = cadSketchFrame(document, part);
  if (!frame) return part.sketch;
  let changed = false;
  const entities = part.sketch.entities.map(entity => {
    if (entity.type !== 'point' || !entity.used) return entity;
    const source = document.parts.find(candidate => candidate.id === entity.used!.partId);
    const at = source && cornerAt(document, source, entity.used.pointId, entity.used.side);
    if (!at) return entity;
    const { x, y } = onPlane(frame, at);
    if (Math.abs(x - entity.x) < 1e-9 && Math.abs(y - entity.y) < 1e-9) return entity;
    changed = true;
    return { ...entity, x, y };
  });
  return changed ? { ...part.sketch, entities } : part.sketch;
}
