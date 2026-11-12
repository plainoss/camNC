import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SampleProjectCard } from './SampleProjectCard';

const action = vi.hoisted(() => ({ create: vi.fn(), navigate: vi.fn() }));
vi.mock('./createSampleJob', () => ({ createSampleJob: action.create }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => action.navigate }));
const demo = vi.hoisted(() => ({ on: false, localPreview: false, rehearsal: null as string | null, exit: vi.fn() }));
vi.mock('@/lib/demo/demo-mode', () => ({
  isDemoMode: () => demo.on,
  isLocalPreviewDemo: () => demo.localPreview,
  getRehearsalId: () => demo.rehearsal,
  exitDemo: demo.exit,
}));

afterEach(() => {
  cleanup();
  action.create.mockReset();
  action.navigate.mockReset();
  Object.assign(demo, { on: false, localPreview: false, rehearsal: null });
  demo.exit.mockReset();
});
const show = (autoOpen = false) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SampleProjectCard autoOpen={autoOpen} />
    </QueryClientProvider>
  );

describe('sample entry', () => {
  it('starts only on demand, saves once during a pending click and opens the ordinary Model step', async () => {
    let resolve!: (job: { id: string }) => void;
    action.create.mockImplementation(
      () =>
        new Promise(r => {
          resolve = r;
        })
    );
    show();
    expect(action.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open sample project' }));
    const opening = screen.getByRole<HTMLButtonElement>('button', { name: 'Opening sample…' });
    expect(opening.disabled).toBe(true);
    fireEvent.click(opening);
    expect(action.create).toHaveBeenCalledTimes(1);
    resolve({ id: 'new-sample' });
    await waitFor(() => expect(action.navigate).toHaveBeenCalledWith({ to: '/cam/$jobId/model', params: { jobId: 'new-sample' } }));
  });

  it('explains storage failure and lets the visitor retry without navigating to a partial job', async () => {
    action.create.mockRejectedValueOnce(new DOMException('Quota exceeded', 'QuotaExceededError'));
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Open sample project' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toContain('could not be saved in this browser');
    expect(action.navigate).not.toHaveBeenCalled();
    action.create.mockResolvedValueOnce({ id: 'retry-copy' });
    fireEvent.click(screen.getByRole('button', { name: 'Retry sample project' }));
    await waitFor(() => expect(action.navigate).toHaveBeenCalledWith({ to: '/cam/$jobId/model', params: { jobId: 'retry-copy' } }));
  });

  it('opens a sample intent arriving from the demo choice page only once', async () => {
    action.create.mockResolvedValue({ id: 'from-demo-entry' });
    show(true);
    await waitFor(() => expect(action.navigate).toHaveBeenCalled());
    expect(action.create).toHaveBeenCalledTimes(1);
  });

  it('opens the sample in place on a local build without a sign-in key, where demo mode cannot be left', async () => {
    // Leaving would reload into the same demo with the sample intent, and open the sample again, forever.
    Object.assign(demo, { on: true, localPreview: true });
    action.create.mockResolvedValue({ id: 'local-sample' });
    show(true);
    await waitFor(() => expect(action.navigate).toHaveBeenCalledWith({ to: '/cam/$jobId/model', params: { jobId: 'local-sample' } }));
    expect(demo.exit).not.toHaveBeenCalled();
    expect(action.create).toHaveBeenCalledTimes(1);
  });

  it('leaves a demo that can be left before saving the sample', () => {
    for (const state of [
      { localPreview: false, rehearsal: null },
      { localPreview: true, rehearsal: crypto.randomUUID() },
    ]) {
      Object.assign(demo, { on: true, ...state });
      show();
      fireEvent.click(screen.getByRole('button', { name: 'Open sample project' }));
      expect(demo.exit).toHaveBeenLastCalledWith('/cam?sample=standing-shelf');
      cleanup();
    }
    expect(demo.exit).toHaveBeenCalledTimes(2);
    expect(action.create).not.toHaveBeenCalled();
  });
});
