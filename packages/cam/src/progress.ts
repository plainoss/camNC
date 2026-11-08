/** How far a long computation has got, from 0 to 1. */
export type OnProgress = (fraction: number) => void;

/**
 * Work of a known (estimated) size, done in steps of different sizes. `done(work)` reports that much more of it done;
 * `step(work)` is the progress to hand the next step of that size, so it reports how far it got inside it.
 */
export function progressOver(onProgress: OnProgress | undefined, total: number) {
  let done = 0;
  const report = (at: number) => onProgress?.(total > 0 ? Math.min(1, at / total) : 1);
  return {
    step(work: number): OnProgress | undefined {
      const from = done;
      return onProgress && (fraction => report(from + Math.min(1, Math.max(0, fraction)) * work));
    },
    done(work: number) {
      done += work;
      report(done);
    },
  };
}
