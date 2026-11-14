import type { CadDocument, CadPoint, CadSketch } from '@wbcnc/cad';
import type { CircularPatternParameters } from './circularPatternParameters';
import type { LinearPatternParameters } from './linearPatternParameters';
import type { TransformDragKind, TransformParameters } from './transformParameters';
import type { CadSelectionBox } from './boxSelection';
import type { CadDrawingInference } from '@wbcnc/cad-editor/drawingInference';

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

/** Dragging a tool's on-canvas handle. Each keeps the value the tool had when the drag began, to restore on cancel. */
export type HandleDrag =
  | { tool: 'slot'; center: CadPoint; width: string }
  // A sweep drag adds each move's turn from `last` to `sweep`, so the angle can pass half a turn.
  | {
      tool: 'circularPattern';
      kind: 'center' | 'sweep';
      start: CadPoint;
      parameters: CircularPatternParameters;
      last: number;
      sweep: number;
    }
  | { tool: 'linearPattern'; index: number; anchor: CadPoint; parameters: LinearPatternParameters }
  | { tool: 'transform'; kind: TransformDragKind; start: CadPoint; parameters: TransformParameters }
  | { tool: 'chamfer'; side: number; origin: CadPoint; direction: CadPoint; previous: string[] };

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
