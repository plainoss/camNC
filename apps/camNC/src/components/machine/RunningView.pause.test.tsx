import { FakeFluidnc } from '@wbcnc/fluidnc/testing';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CncApi } from '@/lib/fluidnc/cnc-api';
import { boardProgram, controllerPercent } from '@/lib/machine/pauseHints.fixture';
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
    expect(card()).toMatch(/Ready to start/);
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
});
