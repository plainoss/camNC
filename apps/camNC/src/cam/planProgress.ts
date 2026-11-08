import { create } from 'zustand';

/** A board being planned: how far it got, and when it started (`performance.now()`). */
export interface PlanProgress {
  fraction: number;
  startedAt: number;
}

/** Per board id, the plan the worker is computing for it now. */
export const usePlanProgress = create<Record<string, PlanProgress>>(() => ({}));

/**
 * Follows one plan of a board: `onProgress` for the worker, `end` once it's done or failed. It counts from the
 * worker's first report, since plans of other boards may come first; a later plan of the board takes over from it.
 */
export function followPlan(boardId: string) {
  const run = {};
  let mine: PlanProgress | undefined;
  return {
    onProgress(fraction: number) {
      mine = { fraction, startedAt: mine?.startedAt ?? performance.now() };
      runs.set(boardId, run);
      usePlanProgress.setState({ [boardId]: mine });
    },
    end() {
      if (runs.get(boardId) !== run) return;
      runs.delete(boardId);
      usePlanProgress.setState(state => Object.fromEntries(Object.entries(state).filter(([id]) => id !== boardId)), true);
    },
  };
}
const runs = new Map<string, object>();

/**
 * About how long the rest takes, in seconds, from how long it took to get this far; undefined until there's enough to
 * go by (a second, and a few percent).
 */
export function secondsLeft({ fraction, startedAt }: PlanProgress, now: number): number | undefined {
  const elapsed = (now - startedAt) / 1000;
  if (elapsed < 1 || fraction < 0.03) return undefined;
  return (elapsed * (1 - fraction)) / fraction;
}

/** "about 40 s left", in steps that don't flicker: whole seconds under 10, then 5 s, then minutes. */
export function timeLeftText(seconds: number): string {
  if (seconds < 1.5) return 'almost done';
  if (seconds < 10) return `about ${Math.round(seconds)} s left`;
  if (seconds < 60) return `about ${Math.round(seconds / 5) * 5} s left`;
  return `about ${Math.round(seconds / 60)} min left`;
}
