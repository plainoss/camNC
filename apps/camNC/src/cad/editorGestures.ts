import type { CadDocument, CadSketch } from '@wbcnc/cad';
import type { CadSelectionBox } from './boxSelection';
import type { CadDrawingInference } from './drawingInference';

type Point = { x: number; y: number };

/** The point a chained line or arc goes on from, and the curve it ends. */
export type ChainAnchor = { pointId: string; curveId: string };

/** Dragging geometry in the sketch, solved as it goes. */
export interface DragGesture {
  origin: Point;
  target: Point;
  document: CadDocument;
  preview: CadDocument;
  partId: string;
  selectedIds: string[];
  points: string[];
  radiusEntityId?: string;
  moved: boolean;
  request: number;
  solvedRequest: number;
  working: boolean;
  ended: boolean;
  failure?: string;
  snapPointId?: string;
  dropInference?: CadDrawingInference | null;
}
export interface BoxGesture extends CadSelectionBox {
  screenStart: Point;
  selected: string[];
  additive: boolean;
  moved: boolean;
}
export interface AnnotationGesture {
  id: string;
  document: CadDocument;
  screenStart: Point;
  worldStart: Point;
  position: Point;
  moved: boolean;
}

/** Where a chain goes on from: its point, the way the curve ending there leaves it, and that curve. */
export function chainGeometry(sketch: CadSketch, chain: ChainAnchor | null) {
  if (!chain) return null;
  const points = new Map(sketch.entities.flatMap(e => (e.type === 'point' ? [[e.id, e] as const] : [])));
  const point = points.get(chain.pointId);
  const curve = sketch.entities.find(e => e.id === chain.curveId);
  if (!point || !curve) return null;
  if (curve.type === 'line') {
    const other = points.get(curve.startId === point.id ? curve.endId : curve.startId);
    if (other) return { point, tangent: { x: point.x - other.x, y: point.y - other.y }, curve };
  }
  if (curve.type === 'arc') {
    const center = points.get(curve.centerId);
    if (center) {
      const direction = curve.endId === point.id ? 1 : -1;
      return { point, tangent: { x: -(point.y - center.y) * direction, y: (point.x - center.x) * direction }, curve };
    }
  }
  return null;
}
