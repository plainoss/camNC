import { entityPointIds as curvePointIds, type CadSketch, type CadPoint } from '@wbcnc/cad';
import type { CadViewport } from '@wbcnc/cad-editor/viewState';

export const pointsOf = (sketch: CadSketch) => new Map(sketch.entities.flatMap(e => (e.type === 'point' ? [[e.id, e] as const] : [])));

/** Fit the requested drawing geometry while retaining its supporting face when fitting the whole sketch. */
export function fitSketchView(
  sketch: CadSketch,
  fallback: CadViewport,
  entityIds?: readonly string[],
  faceOutline?: CadPoint[],
  drawnOnFace?: CadPoint[] | null
): CadViewport {
  const points = pointsOf(sketch);
  const included =
    entityIds &&
    new Set(
      entityIds.flatMap(id => {
        const entity = sketch.entities.find(e => e.id === id);
        return entity ? curvePointIds(entity) : [];
      })
    );
  const bounds = [...points.values()].filter(p => !included || included.has(p.id)).map(p => ({ x: p.x, y: p.y }));
  // A face sketch is framed by the face, not just what's drawn on it so far, and so is a part drawn on a face.
  if (faceOutline && !entityIds) bounds.push(...faceOutline);

  if (drawnOnFace) bounds.push(...drawnOnFace);
  for (const e of sketch.entities)
    if ((!entityIds || entityIds.includes(e.id)) && (e.type === 'circle' || e.type === 'arc')) {
      const p = points.get(e.centerId);
      if (p) bounds.push({ x: p.x - e.radius, y: p.y - e.radius }, { x: p.x + e.radius, y: p.y + e.radius });
    }
  if (!bounds.length) return fallback;
  const xmin = Math.min(...bounds.map(p => p.x)),
    xmax = Math.max(...bounds.map(p => p.x));
  const ymin = Math.min(...bounds.map(p => p.y)),
    ymax = Math.max(...bounds.map(p => p.y));
  const margin = 35;
  return { x: xmin - margin, y: -ymax - margin, w: Math.max(100, xmax - xmin + margin * 2), h: Math.max(80, ymax - ymin + margin * 2) };
}
