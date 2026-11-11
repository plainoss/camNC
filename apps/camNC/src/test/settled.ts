import { settledSnapshot, type SettledSnapshot } from '@/lib/settled';
import '@/lib/settledCanvas';
import { notSettled } from '@/lib/settledReport.mjs';

/** What a browser test waits for: the app's settled signal, plus what the page itself says is still going on. */
export interface SettledState extends Omit<SettledSnapshot, 'pending'> {
  pending: SettledSnapshot['pending'] & { busy: number; transition: number };
}

/**
 * Finite CSS animations and transitions still running. A menu or dialog closing stays in the page, and holds focus,
 * until its exit animation ends; infinite ones (a spinner) never end, so they don't count.
 */
function transitions() {
  return document
    .getAnimations()
    .filter(animation => animation.playState === 'running' && Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)))
    .length;
}

/** The settled signal (`src/lib/settled.ts`), plus elements marked aria-busy and running CSS animations. */
export function settledState(): SettledState {
  const snapshot = settledSnapshot();
  return {
    ...snapshot,
    pending: { ...snapshot.pending, busy: document.querySelectorAll('[aria-busy="true"]').length, transition: transitions() },
  };
}

const nextFrame = (limit: number) =>
  new Promise<void>(resolve => {
    // A page whose frames stop (a hidden tab) still reaches the deadline and reports what is pending.
    const timer = setTimeout(resolve, Math.max(limit, 0));
    requestAnimationFrame(() => {
      clearTimeout(timer);
      resolve();
    });
  });

/**
 * Waits until the app has settled: nothing pending (`settledState`) on two animation frames in a row with the same
 * document revision, the rule the behaviour specs use (`e2e/spec/settle.mjs`). Solver and CAM worker calls, saves,
 * queries of a query client given to `trackQueryClient`, design assistant turns, 3D views not yet drawn, busy elements
 * and closing menus all count. Fails after `timeout` ms naming what is still pending, e.g. `The app did not settle
 * within 10 s: still pending: render 1`. Returns the settled state.
 *
 * Use it after rendering and after each input instead of a sleep or a poll for a sign of readiness. What the signal
 * can't see still needs its own wait, with a comment saying why: a lazily loaded view that hasn't started loading yet
 * (`React.lazy` before its module arrives), or a mocked component's props.
 */
export async function settled({ timeout = 10_000 }: { timeout?: number } = {}): Promise<SettledState> {
  const deadline = performance.now() + timeout;
  let last: SettledState | null = null;
  for (;;) {
    await nextFrame(deadline - performance.now());
    const now = settledState();
    const quiet = Object.values(now.pending).every(count => count === 0);
    if (quiet && last?.load === now.load && last.revision === now.revision) return now;
    last = quiet ? now : null;
    if (performance.now() >= deadline) throw notSettled(timeout, now);
  }
}
