import type { CadSketch } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { initialCircularPatternParameters } from './circularPatternParameters';
import type { HandleDrag } from './editorGestures';
import { initialLinearPatternParameters } from './linearPatternParameters';
import { cancelHandleDrag, moveHandleDrag } from './sketchHandleDrags';
import { initialTransformParameters } from './transformParameters';

const client = { clientX: 0, clientY: 0 };

/** The tool values a handle drag writes, held the way the editor's state holds them. */
function editor(sketch: CadSketch = { entities: [], constraints: [] } as unknown as CadSketch) {
  const state = {
    slotWidth: '10',
    circular: initialCircularPatternParameters(),
    linear: initialLinearPatternParameters('mm'),
    transform: initialTransformParameters(),
    chamfer: ['10', '10'],
  };
  const set =
    <K extends keyof typeof state>(key: K) =>
    (next: (typeof state)[K] | ((previous: (typeof state)[K]) => (typeof state)[K])) => {
      state[key] = typeof next === 'function' ? next(state[key]) : next;
    };
  return {
    state,
    input: {
      lengthText: (value: number) => String(Math.round(value * 1e6) / 1e6),
      lengthUnit: 'mm' as const,
      // Screen and sketch coordinates coincide, so a pivot drag snaps to a sketch point under the pointer.
      projectPoint: (point: { x: number; y: number }) => point,
      shownSketch: sketch,
      setSlotWidth: set('slotWidth'),
      setCircularParameters: set('circular'),
      setLinearParameters: set('linear'),
      setTransformParameters: set('transform'),
      setChamferDistances: set('chamfer'),
    },
  };
}

describe('handle drags', () => {
  it('sets the slot width to twice the distance from the slot centre', () => {
    const { state, input } = editor();
    const gesture: HandleDrag = { tool: 'slot', center: { x: 10, y: 0 }, width: '10' };
    moveHandleDrag(input, gesture, { x: 10, y: 3 }, client);
    expect(state.slotWidth).toBe('6');
    moveHandleDrag(input, gesture, { x: 16, y: 8 }, client);
    expect(state.slotWidth).toBe('20');
    cancelHandleDrag(input, gesture);
    expect(state.slotWidth).toBe('10');
  });

  it('moves the circular pattern centre by the pointer travel and restores it on cancel', () => {
    const { state, input } = editor();
    const parameters = { ...state.circular, centerX: '5', centerY: '5' };
    const gesture: HandleDrag = { tool: 'circularPattern', kind: 'center', start: { x: 1, y: 1 }, parameters, last: 0, sweep: 0 };
    moveHandleDrag(input, gesture, { x: 4, y: -1 }, client);
    expect(state.circular).toEqual({ ...parameters, centerX: '8', centerY: '3' });
    cancelHandleDrag(input, gesture);
    expect(state.circular).toBe(parameters);
  });

  it('leaves a circular pattern alone while its parameters do not parse', () => {
    const { state, input } = editor();
    const shown = state.circular;
    const parameters = { ...shown, centerX: 'oops' };
    for (const kind of ['center', 'sweep'] as const) {
      const gesture: HandleDrag = { tool: 'circularPattern', kind, start: { x: 10, y: 0 }, parameters, last: 0, sweep: 0 };
      moveHandleDrag(input, gesture, { x: 0, y: 10 }, client);
      expect(state.circular).toBe(shown);
      expect(gesture).toMatchObject({ last: 0, sweep: 0 });
    }
  });

  it('accumulates a circular sweep past half a turn and restores the pattern on cancel', () => {
    const { state, input } = editor();
    const parameters = state.circular;
    const gesture: HandleDrag = { tool: 'circularPattern', kind: 'sweep', start: { x: 10, y: 0 }, parameters, last: 0, sweep: 0 };
    for (const point of [
      { x: 0, y: 10 },
      { x: -10, y: 0 },
      { x: 0, y: -10 },
    ])
      moveHandleDrag(input, gesture, point, client);
    expect(state.circular).toEqual({ ...parameters, closed: false, angle: '270' });
    cancelHandleDrag(input, gesture);
    expect(state.circular).toBe(parameters);
  });

  it('sets the spacing and angle of the dragged linear pattern direction', () => {
    const { state, input } = editor();
    const parameters = state.linear;
    const gesture = (index: number): HandleDrag => ({ tool: 'linearPattern', index, anchor: { x: 1, y: 1 }, parameters });
    moveHandleDrag(input, gesture(0), { x: 1, y: 31 }, client);
    expect(state.linear).toEqual({ ...parameters, spacingX: '30', angleX: '90' });
    moveHandleDrag(input, gesture(1), { x: -19, y: 1 }, client);
    expect(state.linear).toEqual({ ...parameters, spacingY: '20', angleY: '180' });
    cancelHandleDrag(input, gesture(1));
    expect(state.linear).toBe(parameters);
  });

  it('translates, rotates and scales a transform about its moved pivot', () => {
    const { state, input } = editor();
    const parameters = { ...state.transform, dx: '10' };
    const drag = (kind: 'translate' | 'rotate' | 'scale', point: { x: number; y: number }) => {
      const gesture: HandleDrag = { tool: 'transform', kind, start: { x: 20, y: 0 }, parameters };
      moveHandleDrag(input, gesture, point, client);
      return gesture;
    };
    drag('translate', { x: 23, y: 4 });
    expect(state.transform).toEqual({ ...parameters, dx: '13', dy: '4' });
    drag('rotate', { x: 10, y: 10 });
    expect(state.transform).toEqual({ ...parameters, angle: '90' });
    const scale = drag('scale', { x: 40, y: 0 });
    expect(state.transform).toEqual({ ...parameters, scale: '3' });
    cancelHandleDrag(input, scale);
    expect(state.transform).toBe(parameters);
  });

  it('leaves a transform alone while its parameters do not parse', () => {
    const { state, input } = editor();
    const shown = state.transform;
    const parameters = { ...shown, scale: 'oops' };
    for (const kind of ['translate', 'rotate', 'scale', 'pivot'] as const) {
      moveHandleDrag(input, { tool: 'transform', kind, start: { x: 20, y: 0 }, parameters }, { x: 40, y: 10 }, client);
      expect(state.transform).toBe(shown);
    }
  });

  it('ignores a scale drag that starts on the pivot, where the pointer distance has no ratio', () => {
    const { state, input } = editor();
    const shown = state.transform;
    const parameters = { ...shown, dx: '10' };
    moveHandleDrag(input, { tool: 'transform', kind: 'scale', start: { x: 10, y: 0 }, parameters }, { x: 40, y: 0 }, client);
    expect(state.transform).toBe(shown);
  });

  it('snaps a dragged transform pivot to the sketch point under the pointer', () => {
    const sketch = { entities: [{ id: 'p', type: 'point', x: 30, y: 40 }], constraints: [] } as unknown as CadSketch;
    const { state, input } = editor(sketch);
    const parameters = state.transform;
    const gesture: HandleDrag = { tool: 'transform', kind: 'pivot', start: { x: 0, y: 0 }, parameters };
    moveHandleDrag(input, gesture, { x: 5, y: 6 }, { clientX: 500, clientY: 500 });
    expect(state.transform).toEqual({ ...parameters, pivotX: '5', pivotY: '6' });
    moveHandleDrag(input, gesture, { x: 29, y: 41 }, { clientX: 29, clientY: 41 });
    expect(state.transform).toEqual({ ...parameters, pivotX: '30', pivotY: '40' });
  });

  it('sets one chamfer distance along its edge and restores both on cancel', () => {
    const { state, input } = editor();
    const gesture: HandleDrag = { tool: 'chamfer', side: 1, origin: { x: 0, y: 0 }, direction: { x: 0, y: 1 }, previous: state.chamfer };
    moveHandleDrag(input, gesture, { x: 50, y: 7.25 }, client);
    expect(state.chamfer).toEqual(['10', '7.25']);
    moveHandleDrag(input, gesture, { x: 0, y: -3 }, client);
    expect(state.chamfer).toEqual(['10', '0.001']);
    cancelHandleDrag(input, gesture);
    expect(state.chamfer).toEqual(['10', '10']);
  });
});
