import { signal } from '@preact/signals-react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { boardProgram } from '@/lib/machine/pauseHints.fixture';
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

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  useStore.getState().updateToolpath(boardProgram, 'Board A');
});
afterEach(cleanup);

/** The job of the board program in Hold:0 at `percent`. */
function holdAt(percent: number, holdRequested: boolean) {
  h.api = {
    status: signal({ state: 'Hold', subState: 0 }),
    state: signal('Hold'),
    jobProgress: signal({ file: '/sd/camnc-11111111-1111-1111-1111-111111111111.gcode', percent }),
    jobStartedAt: signal(1),
    holdRequested: signal(holdRequested),
    lastMessage: signal(null),
    overrides: signal({ feed: 100, rapid: 100, spindle: 100 }),
  } as unknown as typeof h.api;
  render(<RunningView />);
}

const generic = 'Paused with Hold. Resume continues the job; Stop ends it.';

it('a Pause late in the cut says Paused with Hold, not Program done', () => {
  holdAt(88.2, true);
  expect(screen.getByTestId('hold-explanation').textContent).toBe(generic);
  expect(screen.queryByText('Program done')).toBeNull();
});

it('a Pause right where the done M0 is still says Paused with Hold', () => {
  holdAt(99.96, true);
  expect(screen.getByTestId('hold-explanation').textContent).toBe(generic);
  expect(screen.queryByText('Program done')).toBeNull();
});

it('a hold early in the cut that camNC did not send is not the start M0 either', () => {
  holdAt(12.2, false);
  expect(screen.getByTestId('hold-explanation').textContent).toBe(generic);
  expect(screen.queryByText('Ready to start')).toBeNull();
});

it('stopped at the done M0 itself, the program done steps show', () => {
  holdAt(99.96, false);
  expect(screen.getByText('Program done')).toBeTruthy();
});
