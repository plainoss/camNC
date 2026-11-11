import { useCamMachine } from '@/cam/machine/camMachine';
import { getCncApi } from '@/lib/fluidnc/machine';
import { applyDemoPreset } from '@/lib/demo/demo-preset';
import { getJobChecklist } from '@/lib/machine/workflow';
import { getMachineBounds, useStore } from '@/store/store';
import { renderHook } from '@testing-library/react';
import { DemoFluidnc } from '@wbcnc/fluidnc/demo';
import { Vector3 } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { useInitToolpathOffset } from './useInitToolpathOffset';

/** A program that cuts around a `w` × `h` outline from the work zero. */
const outline = (w: number, h: number) => `G21 G90\nG0 Z5\nG0 X0 Y0\nG1 Z-1 F300\nG1 X${w} F1000\nG1 Y${h}\nG1 X0\nG1 Y0\nG0 Z5\n`;

/** Loads a board's program onto the demo machine as the Machine stage does, then lets the hook place it. */
function loadOnDemoMachine(board: { w: number; h: number }, toolpath: { w: number; h: number }) {
  applyDemoPreset(location.origin, { camera: false });
  const wco = new DemoFluidnc().wco;
  getCncApi().currentZero.value = { ...wco };
  useStore.getState().setToolpathOffset(new Vector3(0, 0, 0));
  useStore.getState().updateToolpath(outline(toolpath.w, toolpath.h), 'Board.gcode');
  // As the queue card's Load does; set directly, since setup commands are guarded while the recovery check is pending.
  useCamMachine.setState({ overlay: { w: board.w, h: board.h, rotationDeg: 0 } });
  renderHook(() => useInitToolpathOffset());
  const offset = useStore.getState().toolpathOffset;
  const bounds = useStore.getState().toolpath!.getBounds();
  const bed = getMachineBounds()!;
  const bounded = getJobChecklist({
    gcode: useStore.getState().toolpath!.gcode,
    homed: true,
    zZeroed: true,
    toolpathBounds: { min: bounds.min, max: bounds.max },
    toolpathOffset: offset,
    machineZero: wco,
    machineBounds: bed,
  }).find(i => i.id === 'bounds')!;
  return { offset, bed, wco, bounded };
}

afterEach(() => {
  getCncApi().currentZero.value = null;
  useCamMachine.setState({ overlay: null });
});

describe('the first board on the demo machine', () => {
  it('puts the default cupboard’s Board A fully on the bed, with no bounds warning', () => {
    // Board A of the default cupboard: a 594 × 1200 board whose program spans 588.39 × 1194.39 from its zero.
    const { offset, bed, wco, bounded } = loadOnDemoMachine({ w: 594, h: 1200 }, { w: 588.39, h: 1194.39 });
    // The demo zero alone would put it 123 mm past X and 179 mm past Y.
    expect(wco.x + 594).toBeGreaterThan(bed.max.x);
    expect(wco.y + 1200).toBeGreaterThan(bed.max.y);
    expect(offset.x).toBeGreaterThanOrEqual(bed.min.x);
    expect(offset.y).toBeGreaterThanOrEqual(bed.min.y);
    expect(offset.x + 594).toBeLessThanOrEqual(bed.max.x);
    expect(offset.y + 1200).toBeLessThanOrEqual(bed.max.y);
    expect(bounded).toMatchObject({ ok: true, label: 'Inside machine bounds' });
  });

  it('keeps a small board at the work zero', () => {
    const { offset, wco, bounded } = loadOnDemoMachine({ w: 200, h: 300 }, { w: 194, h: 294 });
    expect({ x: offset.x, y: offset.y }).toEqual({ x: wco.x, y: wco.y });
    expect(bounded.ok).toBe(true);
  });

  it('still warns about a board bigger than the bed', () => {
    const { bed, bounded } = loadOnDemoMachine({ w: 700, h: 1300 }, { w: 694, h: 1294 });
    expect(700).toBeGreaterThan(bed.max.x - bed.min.x);
    expect(bounded).toMatchObject({ ok: false, label: 'Toolpath extends outside the machine bounds' });
  });
});
