import { FakeFluidnc } from '@wbcnc/fluidnc/testing';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CncApi } from '@/lib/fluidnc/cnc-api';
import fusionBack from '../../../../../packages/cam/test/fixtures/kinderregal-eiche-back.gcode?raw';
import { boardProgram, camProgram, controllerPercent } from '@/lib/machine/pauseHints.fixture';
import { useStore } from '@/store/store';
import { RunningView } from './RunningView';
const h = vi.hoisted(() => ({ api: null as unknown as import('@/lib/fluidnc/cnc-api').CncApi }));
vi.mock('@/lib/fluidnc/machine', () => ({ getCncApi: () => h.api, getExistingCncApi: () => h.api }));
vi.mock('@/lib/fluidnc/machineInstance', () => ({ getExistingCncApi: () => h.api }));
vi.mock('@/lib/machine/jobs', () => ({
  isCamncJobFile: () => true,
  isJobOfToolpath: () => true,
  runningJobTitle: () => 'Board A',
  stopJob: vi.fn(),
  errorText: String,
}));
vi.mock('./controls', () => ({ PositionLine: () => null, OverridesPanel: () => null }));
vi.mock('./AlarmCard', () => ({ AlarmCard: () => null }));

const until = async (predicate: () => boolean, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await act(() => new Promise(resolve => setTimeout(resolve, 10)));
  }
};

const generic = 'Paused with Hold. Resume continues the job; Stop ends it.';
const sd = (byte: number) => controllerPercent(byte, 13_225);
const file = '/sd/camnc-11111111-1111-1111-1111-111111111111.gcode';

let fake: FakeFluidnc;
/** Rendered again after each report: the signals transform does not run in this test build. */
let view: ReturnType<typeof render> | null = null;
beforeEach(async () => {
  useStore.setState(useStore.getInitialState(), true);
  useStore.getState().updateToolpath(boardProgram, 'Board A');
  fake = new FakeFluidnc('v4');
  // Work Z zero 30 mm above machine Z zero: the safe Z 23.3 is machine Z -6.7.
  fake.wco = { x: 0, y: 0, z: -30 };
  h.api = new CncApi(fake.WebSocket);
  h.api.connect(fake.host);
  await until(() => h.api.connection.value === 'connected');
});
afterEach(() => {
  cleanup();
  view = null;
  h.api.disconnect();
});

/** The controller reports the board job in `state` at byte `byte`, with the bit at machine Z `z`. */
async function report(state: string, byte: number, z: number) {
  fake.state = state;
  fake.job = { file, percent: sd(byte) };
  fake.mpos = { x: 10, y: 10, z };
  fake.pushStatus();
  await until(() => h.api.status.value?.state === state.split(':')[0] && h.api.jobProgress.value?.percent === sd(byte));
  view?.rerender(<RunningView />);
}

const card = () => screen.getByTestId(screen.queryByTestId('pause-steps') ? 'pause-steps' : 'hold-explanation').textContent;
const pause = async () => {
  fireEvent.click(screen.getByRole('button', { name: /Pause/ }));
  expect(h.api.holdRequested.value).toBe(true);
};

describe('the hold card, from the controller through CncApi', () => {
  it('a Pause does not show the connect-time $I message as the controller reason (#915)', async () => {
    h.api.disconnect();
    fake.respond = line => (line === '$I' ? ['[VER:4.0 FluidNC v4.0.0:]', '[MSG: Machine: LowRider]', 'ok'] : undefined);
    h.api = new CncApi(fake.WebSocket);
    h.api.connect(fake.host);
    await until(() => h.api.connection.value === 'connected');
    view = render(<RunningView />);
    await report('Run', 11_000, -36);
    await pause();
    await report('Hold:0', 11_664, -36);
    expect(card()).toContain(generic);
    expect(card()).not.toContain('Controller:');
    expect(card()).not.toContain('LowRider');
  });

  it('a Pause late in the cut says Paused with Hold, not Program done', async () => {
    view = render(<RunningView />);
    await report('Run', 11_000, -36);
    await pause();
    await report('Hold:0', 11_664, -36);
    expect(card()).toContain(generic);
    expect(screen.queryByText('Program done')).toBeNull();
  });

  it('a Pause during the lift, Resume with the Run report missed: the start M0 still shows Ready to start', async () => {
    view = render(<RunningView />);
    await report('Run', 300, -20);
    await pause();
    await report('Hold:0', 300, -20);
    // Below the safe Z the start card would not be about the bit's position yet.
    expect(card()).toContain(generic);
    fireEvent.click(screen.getByRole('button', { name: /Resume/ }));
    await until(() => !h.api.holdRequested.value);
    // No Run report: the controller lifts on and stops at the start M0.
    await report('Hold:0', 477, -6.7);
    expect(card()).toMatch(/Ready to start/);
    expect(card()).toMatch(/Router on, then Resume/);
  });

  it('after a reconnect the start M0 still shows Ready to start, even with the Pause still noted', async () => {
    view = render(<RunningView />);
    await report('Run', 300, -20);
    await pause();
    await report('Hold:0', 477, -6.7);
    fake.kill();
    await until(() => h.api.connection.value !== 'connected');
    h.api.retryNow();
    await until(() => h.api.connection.value === 'connected', 10_000);
    await report('Hold:0', 477, -6.7);
    expect(h.api.holdRequested.value).toBe(true);
    expect(card()).toMatch(/Ready to start/);
  });

  it('with the controller reporting the spindle running, the start pause is not shown', async () => {
    view = render(<RunningView />);
    fake.accessories = 'S';
    fake.spindleSpeed = 15000;
    await report('Hold:0', 477, -6.7);
    await until(() => h.api.status.value?.spindleOn === true);
    view.rerender(<RunningView />);
    expect(card()).toContain(generic);
    fake.accessories = '';
    fake.spindleSpeed = 0;
    await report('Hold:0', 477, -6.7);
    await until(() => h.api.status.value?.spindleOn === false);
    view.rerender(<RunningView />);
    expect(card()).toMatch(/Ready to start/);
  });

  it('in a 1 MB program, a spindle reported off only before the hold does not show the start pause', async () => {
    const { gcode, size, startEnd, travelEnd } = camProgram(1_000_000);
    useStore.getState().updateToolpath(gcode, 'Board A');
    const frame = (state: string, byte: number, ov: string) =>
      `<${state}|MPos:10.000,10.000,-6.700|FS:0,15000|WCO:0.000,0.000,-30.000${ov}|SD:${controllerPercent(byte, size).toFixed(2)},${file}>`;
    const emit = async (line: string, done: () => boolean) => {
      fake.emit([line]);
      await until(done);
      view?.rerender(<RunningView />);
    };
    view = render(<RunningView />);
    // Off as reported before the M3 ran, then held in the travel after it with no report of the spindle since.
    await emit(frame('Run', startEnd, '|Ov:100,100,100'), () => h.api.status.value?.spindleOn === false);
    await emit(frame('Hold:0', travelEnd, ''), () => h.api.state.value === 'Hold');
    expect(h.api.spindleInHold.value).toBeUndefined();
    expect(card()).toContain(generic);
    // The next report with the accessories says it runs.
    await emit(frame('Hold:0', travelEnd, '|Ov:100,100,100|A:S'), () => h.api.spindleInHold.value === true);
    expect(card()).toContain(generic);
  });

  it('in a 1 MB program held at the start M0, the start pause shows once a report during the hold says the spindle is off', async () => {
    const { gcode, size, startEnd } = camProgram(1_000_000);
    useStore.getState().updateToolpath(gcode, 'Board A');
    const frame = (ov: string) =>
      `<Hold:0|MPos:10.000,10.000,-6.700|FS:0,0|WCO:0.000,0.000,-30.000${ov}|SD:${controllerPercent(startEnd, size).toFixed(2)},${file}>`;
    view = render(<RunningView />);
    fake.emit([frame('')]);
    await until(() => h.api.state.value === 'Hold' && h.api.jobProgress.value?.file === file);
    view.rerender(<RunningView />);
    // The window of a file this size reaches past the M3: no proof from the position alone.
    expect(card()).toContain(generic);
    fake.emit([frame('|Ov:100,100,100')]);
    await until(() => h.api.spindleInHold.value === false);
    view.rerender(<RunningView />);
    expect(card()).toMatch(/Ready to start/);
  });

  it('stopped at the done M0 with the bit parked, the program done steps show', async () => {
    view = render(<RunningView />);
    await report('Run', 13_000, -36);
    await report('Hold:0', 13_220, -5);
    expect(card()).toMatch(/Program done/);
  });

  it('a hold from elsewhere, with the reader near the done M0 while the bit still cuts, is a plain Hold', async () => {
    view = render(<RunningView />);
    await report('Run', 13_000, -36);
    await report('Hold:0', 13_220, -36);
    expect(card()).toContain(generic);
  });

  it('a Fusion program held at its first M0, before any move, says to turn the router on, also after a reload', async () => {
    const bytes = (text: string) => new TextEncoder().encode(text).length;
    const percentAfter = (text: string) =>
      controllerPercent(bytes(fusionBack.slice(0, fusionBack.indexOf('\n', fusionBack.indexOf(text)) + 1)), bytes(fusionBack));
    useStore.getState().updateToolpath(fusionBack, 'back');
    // Found running at the M0: this tab did not start the job, so it does not know where the bit was then.
    fake.state = 'Hold:0';
    fake.job = { file, percent: percentAfter('M0 (MSG Turn ON 15000RPM)') };
    fake.pushStatus();
    await until(() => h.api.jobProgress.value?.percent === fake.job!.percent);
    expect(h.api.jobStartPos.value).toBeNull();
    view = render(<RunningView />);
    expect(card()).toContain('Turn ON 15000RPM');
    // Held again with the reader past the first move after the M0: the job ran on.
    fake.state = 'Run';
    fake.job = { file, percent: percentAfter('X-2.64 Y189.682 F9000') };
    fake.pushStatus();
    await until(() => h.api.state.value === 'Run');
    fake.state = 'Hold:0';
    fake.pushStatus();
    await until(() => h.api.state.value === 'Hold');
    view.rerender(<RunningView />);
    expect(card()).toContain(generic);
  });
});
