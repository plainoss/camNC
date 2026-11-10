import {
  cadCornerSources,
  cadSketchFrame,
  cornerKey,
  type CadDocument,
  type CadPart,
  type CadPoint,
  type CadPointEntity,
  type CadSketch,
} from '@wbcnc/cad';
import type { CadDrawingInference } from '@wbcnc/cad-editor/drawingInference';
import type { PartEdge } from './partEdges';

interface CornerInference extends CadDrawingInference {
  sourceCorner?: NonNullable<CadPointEntity['used']>;
}

/** A corner in the sketch's plane wins over grid rounding, even when it belongs to another part. */
export function partCornerInference(
  document: CadDocument | undefined,
  part: CadPart | undefined,
  edges: PartEdge[],
  raw: CadPoint,
  inference: CadDrawingInference,
  project: (p: CadPoint) => CadPoint,
  lockedAxes: { x?: number; y?: number } = {}
): CadDrawingInference {
  if (!document || !part || inference.snap) return inference;
  const frame = cadSketchFrame(document, part);
  if (!frame) return inference;
  const sourceParts = new Map<string, ReturnType<typeof cadCornerSources>>(),
    screen = project(raw);
  let nearest: { point: CadPoint; sourceCorner: NonNullable<CadPointEntity['used']>; distance: number } | undefined;
  for (const edge of edges) {
    // Off-plane edges project elsewhere once the camera is turned; they cannot be snapped as plane geometry.
    if (!edge.onPlane) continue;
    if (!sourceParts.has(edge.partId)) sourceParts.set(edge.partId, cadCornerSources(document, frame, part.id, edge.partId));
    const sources = sourceParts.get(edge.partId)!;
    for (const point of [
      { x: edge.x1, y: edge.y1 },
      { x: edge.x2, y: edge.y2 },
    ]) {
      // A line's inferred orientation must not be contradicted by a nearby external corner.
      if (
        (lockedAxes.x !== undefined && Math.abs(point.x - lockedAxes.x) > 1e-6) ||
        (lockedAxes.y !== undefined && Math.abs(point.y - lockedAxes.y) > 1e-6)
      )
        continue;
      const sourceCorner = sources.get(cornerKey(point.x, point.y));
      if (!sourceCorner) continue;
      const at = project(point),
        distance = Math.hypot(at.x - screen.x, at.y - screen.y);
      if (distance <= 8 && (!nearest || distance < nearest.distance)) nearest = { point, sourceCorner, distance };
    }
  }
  return nearest
    ? ({ point: nearest.point, sourceCorner: nearest.sourceCorner, snap: null, alignments: [], guides: [] } as CornerInference)
    : inference;
}

/** Keep the newly drawn corner tied to its source, so later depth changes carry the sketch with it. */
export function bindPartCorners(before: CadSketch, after: CadSketch, hints: (CadDrawingInference | null)[]): CadSketch {
  const old = new Set(before.entities.map(e => e.id));
  const corners = hints.filter((hint): hint is CornerInference => !!(hint as CornerInference | null)?.sourceCorner);
  if (!corners.length) return after;
  return {
    ...after,
    entities: after.entities.map(e => {
      if (e.type !== 'point' || old.has(e.id)) return e;
      const found = corners.find(hint => Math.hypot(e.x - hint.point.x, e.y - hint.point.y) < 1e-6);
      return found ? { ...e, fixed: true, used: found.sourceCorner } : e;
    }),
  };
}
