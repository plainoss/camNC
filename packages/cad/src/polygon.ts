import { addCircle, newCadId } from './document';
import { CAD_GEOMETRY_TOLERANCE } from './tolerances';
import type { CadPoint, CadSketch, CadEntity, CadLineEntity, CadConstraint } from './types';
/** The definition circle is inscribed inside the polygon; the radius point is a side midpoint. */
export function inscribedPolygonFromPoints(center: CadPoint, point: CadPoint, sides: number) {
  if (!Number.isInteger(sides) || sides < 3 || sides > 50 || ![center.x, center.y, point.x, point.y].every(Number.isFinite)) return null;
  const apothem = Math.hypot(point.x - center.x, point.y - center.y),
    angle = Math.atan2(point.y - center.y, point.x - center.x);
  if (!Number.isFinite(apothem) || apothem <= CAD_GEOMETRY_TOLERANCE) return null;
  const radius = apothem / Math.cos(Math.PI / sides);
  if (!Number.isFinite(radius)) return null;
  const corners = Array.from({ length: sides }, (_, i) => ({
    x: center.x + radius * Math.cos(angle + ((2 * i - 1) * Math.PI) / sides),
    y: center.y + radius * Math.sin(angle + ((2 * i - 1) * Math.PI) / sides),
  }));
  return corners.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)) ? { center, apothem, radius, corners } : null;
}
/** The construction circle circumscribes this polygon; the radius point is a vertex. */
export function circumscribedPolygonFromPoints(center: CadPoint, point: CadPoint, sides: number) {
  if (!Number.isInteger(sides) || sides < 3 || sides > 50 || ![center.x, center.y, point.x, point.y].every(Number.isFinite)) return null;
  const radius = Math.hypot(point.x - center.x, point.y - center.y),
    angle = Math.atan2(point.y - center.y, point.x - center.x);
  if (!Number.isFinite(radius) || radius <= CAD_GEOMETRY_TOLERANCE) return null;
  const corners = Array.from({ length: sides }, (_, i) => ({
    x: center.x + radius * Math.cos(angle + (2 * i * Math.PI) / sides),
    y: center.y + radius * Math.sin(angle + (2 * i * Math.PI) / sides),
  }));
  return corners.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))
    ? { center, apothem: radius * Math.cos(Math.PI / sides), radius, corners }
    : null;
}
type PolygonOptions = { center: CadPoint; point: CadPoint; sides: number; construction?: boolean };
export function addInscribedPolygon(sketch: CadSketch, options: PolygonOptions): CadSketch {
  return addPolygon(sketch, options, 'inscribed');
}
export function addCircumscribedPolygon(sketch: CadSketch, options: PolygonOptions): CadSketch {
  return addPolygon(sketch, options, 'circumscribed');
}
function addPolygon(sketch: CadSketch, options: PolygonOptions, mode: 'inscribed' | 'circumscribed'): CadSketch {
  const shape = (mode === 'inscribed' ? inscribedPolygonFromPoints : circumscribedPolygonFromPoints)(
    options.center,
    options.point,
    options.sides
  );
  if (!shape) throw new Error('Choose a nonzero polygon radius and an integer side count from 3 to 50.');
  const base = addCircle(sketch, { ...options.center, radius: mode === 'inscribed' ? shape.apothem : shape.radius, construction: true });
  const circle = base.entities.at(-1)!;
  const entities: CadEntity[] = [],
    edges: CadLineEntity[] = [];
  for (let i = 0; i < options.sides; i++) {
    const a = { ...shape.corners[i]!, id: newCadId(), type: 'point' as const, construction: options.construction, standalone: false };
    const b = {
      ...shape.corners[(i + 1) % options.sides]!,
      id: newCadId(),
      type: 'point' as const,
      construction: options.construction,
      standalone: false,
    };
    const edge = { id: newCadId(), type: 'line' as const, startId: a.id, endId: b.id, construction: options.construction };
    entities.push(a, b, edge);
    edges.push(edge);
  }
  const joins: CadConstraint[] = edges.map((edge, i) => ({
    id: newCadId(),
    type: 'coincident',
    pointAId: edge.endId,
    pointBId: edges[(i + 1) % edges.length]!.startId,
  }));
  return {
    ...base,
    entities: [...base.entities, ...entities],
    constraints: [
      ...base.constraints,
      ...joins,
      { id: newCadId(), type: 'regularPolygon', circleId: circle.id, edgeIds: edges.map(e => e.id), mode },
    ],
  };
}
