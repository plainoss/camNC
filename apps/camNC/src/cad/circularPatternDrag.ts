import type { CircularPatternParameters } from './circularPatternParameters';
import type { HandleDrag } from './editorGestures';
import { sketchPointAtClient } from './sketchViewport';

/** Starts dragging a circular pattern's handle, from where the pointer went down on the drawing. */
export function startCircularPatternDrag(
  kind: Extract<HandleDrag, { tool: 'circularPattern' }>['kind'],
  event: { pointerId: number; clientX: number; clientY: number },
  drawing: SVGGraphicsElement | null,
  pattern: { center: { x: number; y: number }; angle: number; count: number; closed: boolean },
  parameters: CircularPatternParameters,
  start: (event: { pointerId: number }, gesture: HandleDrag) => void
) {
  const at = sketchPointAtClient(event, drawing);
  if (!at) return;
  start(event, {
    tool: 'circularPattern',
    kind,
    start: at,
    parameters,
    last: Math.atan2(at.y - pattern.center.y, at.x - pattern.center.x),
    sweep: ((pattern.angle * Math.PI) / 180) * (pattern.closed ? (pattern.count - 1) / pattern.count : 1),
  });
  drawing?.ownerSVGElement?.focus();
}
