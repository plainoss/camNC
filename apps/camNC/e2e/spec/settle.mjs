/**
 * The one readiness rule for spec steps: after a step, nothing is read or checked until the app has settled. The app's
 * dev build reports what is still pending (`src/lib/settled.ts`): solver calls, CAM worker calls, saves, a loading
 * route, fetching queries and a frame not yet drawn since the last input or change.
 */

/** Long enough for a loaded CI runner to finish planning the boards of a job; a step that is still busy then fails. */
export const SETTLE_TIMEOUT_MS = 90_000;

/** What the app reports now, or null on a page without the signal (or one that is navigating). */
export const settledSnapshot = page => page.evaluate(() => window.__camncSettled?.() ?? null).catch(() => null);

const describe = snapshot => {
  if (!snapshot) return 'the page has no settled signal (window.__camncSettled), so it is not the camNC dev server';
  const busy = Object.entries(snapshot.pending).filter(([, count]) => count > 0);
  return busy.length
    ? `still pending: ${busy.map(([kind, count]) => `${kind} ${count}`).join(', ')}`
    : `the document kept changing (revision ${snapshot.revision})`;
};

let probes = 0;

/**
 * Waits until nothing is pending on two animation frames in a row with the same document revision, at or after the
 * revision `since` saw (taken before the step's input). Fails naming what is still pending.
 */
export async function waitSettled(page, since = null, timeout = SETTLE_TIMEOUT_MS) {
  const probe = `__camncSettleProbe${++probes}`;
  try {
    await page.waitForFunction(
      ([probe, since]) => {
        const now = window.__camncSettled?.();
        const last = window[probe];
        const quiet =
          !!now &&
          Object.values(now.pending).every(count => count === 0) &&
          (since?.load !== now.load || now.revision >= since.revision);
        window[probe] = quiet ? now : null;
        if (!quiet || last?.load !== now.load || last.revision !== now.revision) return false;
        delete window[probe];
        return true;
      },
      [probe, since],
      { polling: 'raf', timeout }
    );
  } catch (error) {
    if (!/Timeout/i.test(String(error?.message))) throw error;
    throw new Error(`The app did not settle within ${timeout / 1000} s: ${describe(await settledSnapshot(page))}`);
  }
}
