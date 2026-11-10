import type { CadPoint } from '@wbcnc/cad';

/** Keep a value editor inside the sketch's viewport, above the selected geometry. */
export function sketchValuePosition(
  anchor: CadPoint | null,
  svg: SVGSVGElement | null,
  drawingGroup: SVGGElement | null,
  desiredWidth = 216,
  topOffset = 12
) {
  const matrix = (drawingGroup ?? svg)?.getScreenCTM();
  const drawing = svg?.closest('.cad-drawing')?.getBoundingClientRect();
  if (!anchor || !matrix || !drawing) return undefined;
  const screen = new DOMPoint(anchor.x, -anchor.y).matrixTransform(matrix);
  const width = Math.min(desiredWidth, Math.max(0, drawing.width - 16));
  return {
    left: Math.max(8, Math.min(screen.x - drawing.left - width / 2, drawing.width - width - 8)),
    top: Math.max(8, Math.min(screen.y - drawing.top + topOffset, drawing.height - 44 - 8)),
    width,
  };
}

export function projectSketchPoint(point: CadPoint, drawing: SVGGraphicsElement | null) {
  const matrix = drawing?.getScreenCTM();
  if (!matrix) return { x: point.x, y: -point.y };
  const p = new DOMPoint(point.x, -point.y).matrixTransform(matrix);
  return { x: p.x, y: p.y };
}

/** Focus must not scroll a narrow viewport and shift the drawing. */
export function focusSketchCanvas(canvas: SVGSVGElement | null) {
  canvas?.focus({ preventScroll: true });
}
