import { createCadPart, type CadPoint, type CadSketch } from '@wbcnc/cad';
import { addDrawingRelations, drawnSelection, withSizeExpressions } from './drawingCommit';
import { idleDrawingGesture, transitionDrawingGesture } from './drawingGesture';
import { drawingClickPoint, type CadDrawingInference } from './drawingInference';
import { pickSketchSnap } from './picking';
import { createRectangle, isRectangleTool, rectanglePrompt, type RectangleTool } from './rectangleTool';

/** Thrown for input the headless sketch doesn't model yet, so a caller can tell a gap from a wrong result. */
export class UnsupportedSketchInput extends Error {}

/** The tools that run without a browser, with their visible names and shortcuts. */
export const HEADLESS_SKETCH_TOOLS: readonly { id: RectangleTool; label: string; key: string }[] = [
  { id: 'rectangle', label: 'Corner rectangle', key: 'g' },
  { id: 'centerRectangle', label: 'Center rectangle', key: 'r' },
];

export interface HeadlessSketchOptions {
  sketch?: CadSketch;
  /** Screen pixels per sketch millimetre, which sets how near a click must be to snap. */
  pxPerMm?: number;
}

export interface HeadlessSketchState {
  sketch: CadSketch;
  /** The active tool's visible name, or `Select`. */
  tool: string;
  status: string;
  selected: string[];
}

/**
 * The sketch editor's drawing behaviour without a page: tools, clicks, drags and the shapes they make, using the same
 * functions as the editor. Positions are sketch millimetres with Y up.
 */
export function createHeadlessSketch({ sketch: initial, pxPerMm = 3 }: HeadlessSketchOptions = {}) {
  let sketch = initial ?? createCadPart().sketch;
  let tool: RectangleTool | 'select' = 'select';
  let pending: CadPoint[] = [];
  let hints: (CadDrawingInference | null)[] = [];
  let hovered: string[] = [];
  let gesture = idleDrawingGesture();
  let status = '';
  let selected: string[] = [];
  const project = (p: CadPoint) => ({ x: p.x * pxPerMm, y: -p.y * pxPerMm });

  const locate = (raw: CadPoint) => {
    const hit = pickSketchSnap(sketch, project(raw), { project });
    if (hit?.targetPointId) hovered = [hit.targetPointId, ...hovered.filter(id => id !== hit.targetPointId)].slice(0, 4);
    return drawingClickPoint(sketch, raw, { project, directSnap: hit, preferredPointIds: hovered });
  };
  const drawingTool = () => {
    if (!isRectangleTool(tool)) throw new UnsupportedSketchInput(`Pointer input with the ${tool} tool`);
    return tool;
  };
  const clearPending = () => {
    pending = [];
    hints = [];
    gesture = idleDrawingGesture();
  };
  const finish = (end: CadDrawingInference) => {
    const active = drawingTool();
    const result = createRectangle(sketch, { tool: active, start: pending[0]!, end: end.point });
    if (result.error !== undefined) {
      status = result.error;
      return;
    }
    let next = withSizeExpressions(sketch, result.sketch, result.sizeExpressions);
    next = addDrawingRelations(sketch, next, [...hints, end], { tool: active });
    selected = drawnSelection(sketch, next, active);
    sketch = next;
    clearPending();
  };
  const choose = (next: RectangleTool | 'select') => {
    // Choosing the active tool again goes back to selecting.
    tool = next === tool ? 'select' : next;
    clearPending();
    status = isRectangleTool(tool) ? rectanglePrompt(tool) : '';
  };

  const press = (at: CadPoint) => {
    drawingTool();
    const point = locate(at);
    if (pending.length) return finish(point);
    pending = [point.point];
    hints = [point];
    gesture = transitionDrawingGesture(gesture, { type: 'press', tool, pointerId: 1, position: project(at), canStart: true }).state;
  };
  const move = (at: CadPoint) => {
    locate(at);
    gesture = transitionDrawingGesture(gesture, { type: 'move', pointerId: 1, position: project(at) }).state;
  };
  const release = (at: CadPoint) => {
    const transition = transitionDrawingGesture(gesture, { type: 'release', pointerId: 1, position: project(at) });
    gesture = transition.state;
    if (transition.effect === 'complete') finish(locate(at));
  };

  return {
    key(key: string) {
      if (key === 'Escape') {
        if (pending.length) clearPending();
        else choose('select');
        return;
      }
      const shortcut = HEADLESS_SKETCH_TOOLS.find(t => t.key === key);
      if (!shortcut) throw new UnsupportedSketchInput(`Key ${key}`);
      choose(shortcut.id);
    },
    tool(label: string) {
      const named = HEADLESS_SKETCH_TOOLS.find(t => t.label.toLowerCase() === label.toLowerCase());
      if (!named) throw new UnsupportedSketchInput(`Tool ${label}`);
      if (named.id !== tool) choose(named.id);
    },
    hover: (at: CadPoint) => void locate(at),
    press,
    move,
    release,
    click(at: CadPoint) {
      press(at);
      release(at);
    },
    drag(from: CadPoint, to: CadPoint) {
      press(from);
      move(to);
      release(to);
    },
    state: (): HeadlessSketchState => ({
      sketch,
      tool: HEADLESS_SKETCH_TOOLS.find(t => t.id === tool)?.label ?? 'Select',
      status,
      selected,
    }),
  };
}

export type HeadlessSketch = ReturnType<typeof createHeadlessSketch>;
