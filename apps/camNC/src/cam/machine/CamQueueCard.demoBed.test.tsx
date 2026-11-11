import { useInitToolpathOffset } from '@/hooks/useInitToolpathOffset';
import { applyDemoPreset } from '@/lib/demo/demo-preset';
import { getCncApi } from '@/lib/fluidnc/machine';
import { recoveryPending } from '@/lib/machine/jobRecoveryState';
import { getJobChecklist } from '@/lib/machine/workflow';
import { getMachineBounds, useStore } from '@/store/store';
import { TooltipProvider } from '@wbcnc/ui/components/tooltip';
import { DemoFluidnc } from '@wbcnc/fluidnc/demo';
import { cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanResult } from '../camTypes';
import type { JobBoard } from '../useJobBoards';
import { currentEntry, machineQueue, useCamMachine, type QueueEntry } from './camMachine';
import { CamQueueCard } from './CamQueueCard';

const hook = vi.hoisted(() => ({ value: {} as Record<string, unknown>, use: (): unknown => undefined }));
vi.mock('./useMachineQueue', () => ({ useMachineQueue: () => hook.use() }));
hook.use = function useFromStore() {
  const { active, done } = useCamMachine();
  return { ...hook.value, done, current: currentEntry(hook.value.queue as QueueEntry[], active, done) };
};

/** A program that cuts around a `w` × `h` outline from the work zero. */
const outline = (w: number, h: number) => `G21 G90\nG0 Z5\nG0 X0 Y0\nG1 Z-1 F300\nG1 X${w} F1000\nG1 Y${h}\nG1 X0\nG1 Y0\nG0 Z5\n`;

/** One board of `size`, whose single program spans `path` from its zero. */
function queueBoard(size: [number, number], path: [number, number]) {
  const gcode = outline(...path);
  const plan = {
    gcode,
    timeMin: 1,
    warnings: [],
    safety: [],
    ops: [{}],
    bits: [6],
    programs: [{ tool: 1, diameter: 6, gcode, timeMin: 1 }],
    size: [...size, 6],
    path: [],
  } as unknown as PlanResult;
  const board = {
    board: { id: 'A', name: 'A', thickness: 6 },
    nest: { gap: 10, margin: 5, unplaced: [] },
    request: { parts: [{ id: 'p' }], holdDown: 'tabs' },
  } as unknown as JobBoard;
  const queue = machineQueue([board], [plan], { bit: 6, missing: [] });
  hook.value = { job: { name: 'job' }, queue, stale: new Set(), loading: false, setStockThickness: vi.fn() };
}

/** The Machine stage's pieces that place a loaded program: the queue card and the first-placement hook. */
function Stage() {
  useInitToolpathOffset();
  return <CamQueueCard />;
}

/** Board `size` with a program spanning `path`, loaded with the queue card's Load button at controller zero `zero`. */
function load(size: [number, number], path: [number, number], zero: { x: number; y: number; z: number }) {
  getCncApi().currentZero.value = zero;
  queueBoard(size, path);
  render(
    <TooltipProvider>
      <Stage />
    </TooltipProvider>
  );
  fireEvent.click(within(screen.getByRole('region', { name: 'CAM job' })).getByRole('button', { name: 'Load program' }));
  const s = useStore.getState();
  const bounds = s.toolpath!.getBounds();
  const bed = getMachineBounds()!;
  const offset = { x: s.toolpathOffset.x, y: s.toolpathOffset.y };
  const check = getJobChecklist({
    gcode: s.toolpath!.gcode,
    homed: true,
    zZeroed: true,
    toolpathBounds: { min: bounds.min, max: bounds.max },
    toolpathOffset: offset,
    machineZero: zero,
    machineBounds: bed,
  });
  return { offset, bed, bounds: check.find(i => i.id === 'bounds')!, zeroMatches: check.find(i => i.id === 'xy-zero')!.ok };
}

const demoZero = () => new DemoFluidnc().wco;

beforeEach(() => {
  applyDemoPreset(location.origin, { camera: false });
  // Setup commands wait while the recovery check is pending; a fresh page has none to do. The controller connection
  // is made first, so that its own start of the check doesn't come after this.
  getCncApi();
  recoveryPending.value = false;
  useCamMachine.setState({ ...useCamMachine.getInitialState(), jobId: 'j1' }, true);
  useStore.setState(s => {
    s.toolpath = null;
    s.toolpathName = null;
  });
  useStore.getState().setToolpathOffset(new Vector3(0, 0, 0));
});

afterEach(() => {
  cleanup();
  getCncApi().currentZero.value = null;
  getCncApi().jobStartedAt.value = null;
  useCamMachine.setState(useCamMachine.getInitialState(), true);
});

describe('the first board on the demo machine', () => {
  it('puts the default cupboard’s Board A on the bed at the demo zero, with no bounds warning', () => {
    // Board A of the default cupboard: 594 × 1200, its program spans 588.39 × 1194.39 from its zero.
    const zero = demoZero();
    const { offset, bed, bounds, zeroMatches } = load([594, 1200], [588.39, 1194.39], zero);
    expect(offset).toEqual({ x: zero.x, y: zero.y });
    expect(zeroMatches).toBe(true);
    expect(offset.x).toBeGreaterThanOrEqual(bed.min.x);
    expect(offset.y).toBeGreaterThanOrEqual(bed.min.y);
    expect(offset.x + 594).toBeLessThanOrEqual(bed.max.x);
    expect(offset.y + 1200).toBeLessThanOrEqual(bed.max.y);
    expect(bounds).toMatchObject({ ok: true, label: 'Inside machine bounds' });
  });

  it('still warns about a board bigger than the bed', () => {
    const { bed, bounds } = load([700, 1300], [694, 1294], demoZero());
    expect(700).toBeGreaterThan(bed.max.x - bed.min.x);
    expect(bounds).toMatchObject({ ok: false, label: 'Toolpath extends outside the machine bounds' });
  });

  it('keeps a controller’s own zero exactly, even where the board would overhang', () => {
    // The zero a person set on their stock: the program is drawn (and its Run zeroes) there, never moved onto the bed.
    const zero = { x: 312.5, y: 640.25, z: -12 };
    const { offset, bounds, zeroMatches } = load([594, 1200], [588.39, 1194.39], zero);
    expect(offset).toEqual({ x: 312.5, y: 640.25 });
    expect(zeroMatches).toBe(true);
    expect(bounds.ok).toBe(false);
  });
});

describe('the first placement while a job is under way', () => {
  it('leaves the drawing where the running job cuts', () => {
    useStore.getState().updateToolpath(outline(100, 80), 'Running.gcode');
    getCncApi().jobStartedAt.value = Date.now();
    getCncApi().currentZero.value = demoZero();
    renderHook(() => useInitToolpathOffset());
    expect(useStore.getState().toolpathOffset.x).toBe(0);
    expect(useStore.getState().toolpathOffset.y).toBe(0);
  });
});
