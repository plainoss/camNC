import {
  inscribedPolygonFromPoints,
  centerPointArcFromPoints,
  ellipseFromPoints,
  circleThroughThreePoints,
  alignedRectangleFromPoints,
  type CadPoint,
} from '@wbcnc/cad';
import { buildArcPreview } from './arcPreviewGeometry';
import type { SketchTool } from './sketchTools';
import { formatCadValue } from './valueExpressions';

export interface SketchToolPreviewInput {
  tool: SketchTool;
  pending: readonly CadPoint[];
  cursor: CadPoint;
  curvePreview?: readonly CadPoint[] | null;
  tangent?: CadPoint;
  pixelScale: number;
  construction?: boolean;
  polygonSides?: number;
  sweepIntent?: number;
}

interface PreviewValue {
  kind: string;
  text: string;
  at: CadPoint;
}

/** Native measurements use source millimetres; annotation offsets and markers use CSS pixels. */
export function sketchPreviewFeedback({ tool, pending, cursor, tangent, pixelScale, sweepIntent, polygonSides }: SketchToolPreviewInput) {
  const start = pending[0],
    scale = Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : 1;
  const values: PreviewValue[] = [],
    markers: CadPoint[] = [];
  if (!start) return { values, markers };
  if (tool === 'line') {
    markers.push(start, cursor);
    const dx = cursor.x - start.x,
      dy = cursor.y - start.y,
      length = Math.hypot(dx, dy),
      sign = dx < 0 || (dx === 0 && dy > 0) ? -1 : 1;
    if (length > 1e-7)
      values.push({
        kind: 'length',
        text: formatCadValue(length),
        at: {
          x: (start.x + cursor.x) / 2 - (sign * dy * 20) / scale / length,
          y: (start.y + cursor.y) / 2 + (sign * dx * 20) / scale / length,
        },
      });
  } else if (tool === 'rectangle' || tool === 'centerRectangle') {
    const left = tool === 'centerRectangle' ? start.x - Math.abs(cursor.x - start.x) : Math.min(start.x, cursor.x);
    const right = tool === 'centerRectangle' ? start.x + Math.abs(cursor.x - start.x) : Math.max(start.x, cursor.x);
    const bottom = tool === 'centerRectangle' ? start.y - Math.abs(cursor.y - start.y) : Math.min(start.y, cursor.y);
    const top = tool === 'centerRectangle' ? start.y + Math.abs(cursor.y - start.y) : Math.max(start.y, cursor.y);
    markers.push({ x: left, y: bottom }, { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom });
    if (tool === 'centerRectangle') markers.push(start);
    if (right - left > 1e-7 || top - bottom > 1e-7) {
      values.push({ kind: 'width', text: formatCadValue(right - left), at: { x: (left + right) / 2, y: top + 16 / scale } });
      const text = formatCadValue(top - bottom);
      values.push({ kind: 'height', text, at: { x: left - (text.length * 3.5 + 12) / scale, y: (top + bottom) / 2 } });
    }
  } else if (tool === 'inscribedPolygon') {
    const shape = inscribedPolygonFromPoints(start, pending[1] ?? cursor, polygonSides ?? 6);
    markers.push(start);
    if (shape)
      values.push({
        kind: 'diameter',
        text: `⌀${formatCadValue(shape.apothem * 2)}`,
        at: { x: start.x, y: start.y + shape.apothem + 20 / scale },
      });
  } else if (tool === 'alignedRectangle') {
    const shape = pending[1] ? alignedRectangleFromPoints(start, pending[1], cursor) : null;
    markers.push(...(shape ? shape.corners : [...pending, cursor]));
    if (shape) {
      const [a, b, c] = shape.corners;
      values.push(
        { kind: 'width', text: formatCadValue(shape.width), at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + 20 / scale } },
        { kind: 'height', text: formatCadValue(shape.height), at: { x: (b.x + c.x) / 2 + 20 / scale, y: (b.y + c.y) / 2 } }
      );
    }
  } else if (tool === 'ellipse') {
    markers.push(...pending);
    const shape = pending[1] ? ellipseFromPoints(start, pending[1], cursor) : null;
    if (shape) {
      values.push(
        { kind: 'primaryDiameter', text: formatCadValue(shape.primary * 2), at: { x: start.x, y: start.y + 20 / scale } },
        { kind: 'secondaryDiameter', text: formatCadValue(shape.secondary * 2), at: { x: start.x, y: start.y - 20 / scale } }
      );
    }
  } else if (tool === 'threePointCircle') {
    markers.push(...pending, cursor);
    const circle = pending[1] ? circleThroughThreePoints(start, pending[1], cursor) : null;
    if (circle)
      values.push({
        kind: 'diameter',
        text: `⌀${formatCadValue(circle.radius * 2)}`,
        at: { x: circle.x, y: circle.y + circle.radius + 20 / scale },
      });
  } else if (tool === 'circle') {
    markers.push(start);
    const radius = Math.hypot(cursor.x - start.x, cursor.y - start.y),
      dx = cursor.x - start.x,
      dy = cursor.y - start.y;
    const text = `⌀${formatCadValue(radius * 2)}`;
    const offset = radius + (text.length * 3.5 + 14) / scale;
    if (radius > 1e-7)
      values.push({ kind: 'diameter', text, at: { x: start.x - (dx / radius) * offset, y: start.y - (dy / radius) * offset } });
  } else if (tool === 'centerPointArc') {
    markers.push(...pending);
    const arc = pending[1] ? centerPointArcFromPoints(start, pending[1], cursor, sweepIntent) : null;
    if (arc) values.push({ kind: 'radius', text: `R${formatCadValue(arc.radius)}`, at: { x: start.x, y: start.y + 20 / scale } });
  } else if (tool === 'arc' || tool === 'tangentArc') {
    const preview = buildArcPreview({ mode: tool === 'arc' ? 'threePoint' : 'tangent', pending, cursor, tangent });
    // A suggested endpoint-stage curve is not a chosen radius.
    if (preview?.arc && !preview.provisional) {
      const { cx, cy, radius } = preview.arc;
      values.push({ kind: 'radius', text: `R${formatCadValue(radius)}`, at: { x: cx, y: cy + 20 / scale } });
    }
  } else if (tool === 'spline' || tool === 'bezier' || tool === 'conic') {
    markers.push(...pending);
    if (!pending.some(point => Math.hypot(point.x - cursor.x, point.y - cursor.y) < 1e-8)) markers.push(cursor);
  }
  return { values, markers };
}
