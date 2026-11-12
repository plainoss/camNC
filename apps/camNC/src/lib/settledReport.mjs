/**
 * How a wait for the settled signal (`settled.ts`) reports a timeout, shared by the behaviour specs
 * (`e2e/spec/settle.mjs`) and the browser tests (`src/test/settled.ts`), so both name what is still pending alike.
 */

/** Why `snapshot` (from `window.__camncSettled()`, or null) is not settled. */
export function describeSettled(snapshot) {
  if (!snapshot) return 'the page has no settled signal (window.__camncSettled), so it is not the camNC dev server';
  const busy = Object.entries(snapshot.pending).filter(([, count]) => count > 0);
  return busy.length
    ? `still pending: ${busy.map(([kind, count]) => `${kind} ${count}`).join(', ')}`
    : `the document kept changing (revision ${snapshot.revision})`;
}

/** The error a wait that gave up after `timeout` ms throws. */
export const notSettled = (timeout, snapshot) =>
  new Error(`The app did not settle within ${timeout / 1000} s: ${describeSettled(snapshot)}`);
