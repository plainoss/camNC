import { originId, updateDimension } from './document';
import { measureDimension } from './dimensions';
import type { CadConstraint, CadDocument, CadSketch } from './types';

/** Lengths only: an angle doesn't say how big the sketch is. */
const LENGTH_DIMENSIONS = new Set<CadConstraint['type']>([
  'distance',
  'distanceX',
  'distanceY',
  'pointLineDistance',
  'lineLineDistance',
  'pointArcDistance',
  'lineCircleDistance',
  'circleCircleDistance',
  'radius',
  'diameter',
]);

/**
 * The first length dimension of a sketch sizes the whole drawing: everything is scaled about the sketch origin so that
 * dimension measures `value`, keeping the drawn proportions. Returns null when the sketch already has a driving
 * dimension or a pattern, is tied to geometry outside it (face edges, used corners, fixed points), or nothing would change.
 */
export function scaleSketchForFirstDimension(sketch: CadSketch, dimensionId: string, value: number): CadSketch | null {
  const dimension = sketch.constraints.find(c => c.id === dimensionId);
  if (!dimension || !('value' in dimension) || dimension.driven || !LENGTH_DIMENSIONS.has(dimension.type)) return null;
  if (sketch.constraints.some(c => c.id !== dimensionId && 'value' in c && !c.driven)) return null;
  // A pattern's spacing and master position act like dimensions of their own, so scaling would pull its copies apart.
  if (sketch.constraints.some(c => c.type === 'linearPattern' || c.type === 'circularPattern')) return null;
  const origin = originId(sketch);
  const anchored = sketch.entities.some(e => e.faceEdge || (e.type === 'point' && e.id !== origin && (e.fixed || e.used)));
  if (anchored) return null;
  const measured = measureDimension(sketch, dimension);
  if (measured === null || !(Math.abs(measured) > 1e-9)) return null;
  const factor = Math.abs(value / measured);
  if (!Number.isFinite(factor) || factor <= 0 || Math.abs(factor - 1) < 1e-9) return null;
  const centre = sketch.entities.find(e => e.id === origin);
  const cx = centre?.type === 'point' ? centre.x : 0;
  const cy = centre?.type === 'point' ? centre.y : 0;
  return {
    ...sketch,
    entities: sketch.entities.map(e => {
      if (e.type === 'point') return e.id === origin ? e : { ...e, x: cx + (e.x - cx) * factor, y: cy + (e.y - cy) * factor };
      if (e.type === 'circle' || e.type === 'arc' || e.type === 'ellipse') return { ...e, radius: e.radius * factor };
      return e;
    }),
  };
}

/** Sets a newly placed dimension's value, sizing the whole sketch when it is the sketch's first length dimension. */
export function applyNewDimension(document: CadDocument, id: string, value: number, expression?: string): CadDocument {
  const part = document.parts.find(p => p.sketch.constraints.some(c => c.id === id));
  const scaled = part && scaleSketchForFirstDimension(part.sketch, id, value);
  const source = scaled ? { ...document, parts: document.parts.map(p => (p === part ? { ...p, sketch: scaled } : p)) } : document;
  return updateDimension(source, id, value, expression);
}
