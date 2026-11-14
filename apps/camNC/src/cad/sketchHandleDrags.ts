import { CAD_GEOMETRY_TOLERANCE, type CadPoint } from '@wbcnc/cad';
import { pickSketchPoint } from '@wbcnc/cad-editor/picking';
import { parseCircularPatternParameters } from './circularPatternParameters';
import type { HandleDrag } from './editorGestures';
import type { SketchEditorInput } from './sketchEditorInput';
import { parseTransformParameters } from './transformParameters';

type HandleDragEditor = Pick<
  SketchEditorInput,
  | 'lengthText'
  | 'lengthUnit'
  | 'projectPoint'
  | 'setChamferDistances'
  | 'setCircularParameters'
  | 'setLinearParameters'
  | 'setSlotWidth'
  | 'setTransformParameters'
  | 'shownSketch'
>;

const text = (n: number) => String(Math.round(n * 1e6) / 1e6);

/** Follow the pointer, at sketch `point`, with the tool value its handle edits. */
export function moveHandleDrag(
  editor: HandleDragEditor,
  gesture: HandleDrag,
  point: CadPoint,
  event: { clientX: number; clientY: number }
) {
  const { lengthText, lengthUnit } = editor;
  switch (gesture.tool) {
    case 'slot': {
      const { center } = gesture;
      editor.setSlotWidth(lengthText(Math.round(2 * Math.hypot(point.x - center.x, point.y - center.y) * 1e6) / 1e6));
      return;
    }
    case 'circularPattern': {
      const parsed = parseCircularPatternParameters(gesture.parameters, lengthUnit);
      if (!parsed.ok) return;
      if (gesture.kind === 'center')
        editor.setCircularParameters({
          ...gesture.parameters,
          centerX: lengthText(parsed.center.x + point.x - gesture.start.x),
          centerY: lengthText(parsed.center.y + point.y - gesture.start.y),
        });
      else {
        const a = Math.atan2(point.y - parsed.center.y, point.x - parsed.center.x);
        gesture.sweep += Math.atan2(Math.sin(a - gesture.last), Math.cos(a - gesture.last));
        gesture.last = a;
        editor.setCircularParameters({
          ...gesture.parameters,
          closed: false,
          angle: text(Math.max(-359.999999, Math.min(359.999999, (gesture.sweep * 180) / Math.PI))),
        });
      }
      return;
    }
    case 'linearPattern': {
      const { index, anchor, parameters } = gesture;
      const x = point.x - anchor.x,
        y = point.y - anchor.y,
        spacing = lengthText(Math.round(Math.hypot(x, y) * 1e6) / 1e6),
        angle = text((Math.atan2(y, x) * 180) / Math.PI);
      editor.setLinearParameters({
        ...parameters,
        ...(index === 0 ? { spacingX: spacing, angleX: angle } : { spacingY: spacing, angleY: angle }),
      });
      return;
    }
    case 'transform': {
      const { kind, start, parameters } = gesture,
        parsed = parseTransformParameters(parameters, lengthUnit);
      if (!parsed.ok) return;
      const center = { x: parsed.pivot.x + parsed.translation.x, y: parsed.pivot.y + parsed.translation.y };
      if (kind === 'translate')
        editor.setTransformParameters({
          ...parameters,
          dx: lengthText(parsed.translation.x + point.x - start.x),
          dy: lengthText(parsed.translation.y + point.y - start.y),
        });
      if (kind === 'rotate') {
        const delta = Math.atan2(point.y - center.y, point.x - center.x) - Math.atan2(start.y - center.y, start.x - center.x);
        editor.setTransformParameters({ ...parameters, angle: text(parsed.angle + (delta * 180) / Math.PI) });
      }
      if (kind === 'scale') {
        const initial = Math.hypot(start.x - center.x, start.y - center.y);
        if (initial > CAD_GEOMETRY_TOLERANCE)
          editor.setTransformParameters({
            ...parameters,
            scale: text(Math.max(0.001, (parsed.scale * Math.hypot(point.x - center.x, point.y - center.y)) / initial)),
          });
      }
      if (kind === 'pivot') {
        const snap = pickSketchPoint(editor.shownSketch!, { x: event.clientX, y: event.clientY }, { project: editor.projectPoint });
        if (snap) point = snap.point;
        const r = (parsed.angle * Math.PI) / 180,
          worldDx = point.x - start.x,
          worldDy = point.y - start.y;
        const x = parsed.pivot.x + (Math.cos(r) * worldDx + Math.sin(r) * worldDy) / parsed.scale,
          y = parsed.pivot.y + (-Math.sin(r) * worldDx + Math.cos(r) * worldDy) / parsed.scale;
        const dx = parsed.pivot.x - x,
          dy = parsed.pivot.y - y,
          c = parsed.scale * Math.cos(r),
          s = parsed.scale * Math.sin(r);
        editor.setTransformParameters({
          ...parameters,
          pivotX: lengthText(x),
          pivotY: lengthText(y),
          dx: lengthText(parsed.translation.x + (1 - c) * dx + s * dy),
          dy: lengthText(parsed.translation.y - s * dx + (1 - c) * dy),
        });
      }
      return;
    }
    case 'chamfer': {
      const { side, origin, direction } = gesture;
      const distance = Math.max(0.001, (point.x - origin.x) * direction.x + (point.y - origin.y) * direction.y);
      editor.setChamferDistances(previous =>
        previous.map((value, index) => (index === side ? lengthText(Math.round(distance * 1000) / 1000) : value))
      );
    }
  }
}

/** Put back the value the tool had when the drag began. */
export function cancelHandleDrag(editor: HandleDragEditor, gesture: HandleDrag) {
  switch (gesture.tool) {
    case 'slot':
      return editor.setSlotWidth(gesture.width);
    case 'circularPattern':
      return editor.setCircularParameters(gesture.parameters);
    case 'linearPattern':
      return editor.setLinearParameters(gesture.parameters);
    case 'transform':
      return editor.setTransformParameters(gesture.parameters);
    case 'chamfer':
      return editor.setChamferDistances(gesture.previous);
  }
}
