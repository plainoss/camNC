import { newCadId } from './document';
import { rectangleCorners } from './rectangleCorners';
import { CAD_GEOMETRY_TOLERANCE } from './tolerances';
import type { CadPoint, CadSketch } from './types';

/** First edge fixes orientation; the third point supplies a signed perpendicular height. */
export function alignedRectangleFromPoints(start: CadPoint, end: CadPoint, through: CadPoint) {
  const dx = end.x - start.x,
    dy = end.y - start.y,
    width = Math.hypot(dx, dy);
  if (![start.x, start.y, end.x, end.y, through.x, through.y, width].every(Number.isFinite) || width <= CAD_GEOMETRY_TOLERANCE) return null;
  const nx = -dy / width,
    ny = dx / width;
  const signedHeight = (through.x - end.x) * nx + (through.y - end.y) * ny;
  if (!Number.isFinite(signedHeight) || Math.abs(signedHeight) <= CAD_GEOMETRY_TOLERANCE) return null;
  const offset = { x: nx * signedHeight, y: ny * signedHeight };
  return {
    width,
    height: Math.abs(signedHeight),
    corners: [start, end, { x: end.x + offset.x, y: end.y + offset.y }, { x: start.x + offset.x, y: start.y + offset.y }] as const,
  };
}

export function addAlignedRectangle(
  sketch: CadSketch,
  options: { start: CadPoint; end: CadPoint; through: CadPoint; construction?: boolean }
): CadSketch {
  const shape = alignedRectangleFromPoints(options.start, options.end, options.through);
  if (!shape) throw new Error('Choose a nonzero first edge and a point away from that edge.');
  const graph = rectangleCorners(shape.corners, { createId: newCadId, construction: options.construction });
  const [base, side, opposite, otherSide] = graph.edges;
  return {
    ...sketch,
    entities: [...sketch.entities, ...graph.entities],
    constraints: [
      ...sketch.constraints,
      ...graph.coincidences,
      { id: newCadId(), type: 'parallel', entityAId: base.id, entityBId: opposite.id },
      { id: newCadId(), type: 'parallel', entityAId: side.id, entityBId: otherSide.id },
      { id: newCadId(), type: 'perpendicular', entityAId: base.id, entityBId: side.id },
    ],
  };
}
