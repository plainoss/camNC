/**
 * Whether the app has caught up with what was last done to it, for behaviour specs and browser tests. Dev and test
 * builds only: in a production build every function here is a no-op and nothing is put on `window`.
 *
 * `window.__camncSettled()` returns a snapshot. The app has settled when every pending count is zero:
 * - `solve`: sketch solver calls in flight (checks, drags, dimension preparation, acceptance).
 * - `worker`: CAM worker calls in flight (imports, the Part Studio's model, part and board plans).
 * - `save`: IndexedDB writes and queued design draft saves not yet finished.
 * - `route`: a navigation still loading its route.
 * - `query`: data queries fetching and mutations running (reading a job, saving boards).
 * - `frame`: 1 until two animation frames have passed since the last input event or change to any of the above, so
 *   React has rendered what that input or result changed.
 *
 * `revision` counts the design document changes the editor has reported since this page loaded, and `load` tells
 * page loads apart, so a caller can tell a change made after it looked from one made before.
 */

export type SettledWork = 'solve' | 'worker' | 'save';
export type SettledProbe = 'route' | 'query';
export interface SettledSnapshot {
  load: number;
  revision: number;
  pending: Record<SettledWork | SettledProbe | 'frame', number>;
}

declare global {
  interface Window {
    __camncSettled?: () => SettledSnapshot;
  }
}

// MODE is supplied by Vite from the command mode, not a process environment input.
// eslint-disable-next-line turbo/no-undeclared-env-vars
const enabled = typeof window !== 'undefined' && (import.meta.env.DEV || import.meta.env.MODE === 'test');
const pending: Record<SettledWork, number> = { solve: 0, worker: 0, save: 0 };
const probes: Record<SettledProbe, () => number> = { route: () => 0, query: () => 0 };
let revision = 0;
let frame = 0;

/** Something changed: pending until two frames later, so whatever it changed has been rendered and painted. */
function touch() {
  if (!enabled) return;
  if (frame) cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      frame = 0;
    });
  });
}

/** Counts `work` as pending of its kind until it settles either way. Returns `work` itself. */
export function trackPending<T>(kind: SettledWork, work: Promise<T>): Promise<T> {
  if (!enabled) return work;
  pending[kind]++;
  touch();
  const done = () => {
    pending[kind]--;
    touch();
  };
  work.then(done, done);
  return work;
}

/** The same remote, with each method call it makes counted as pending `kind` until its result arrives. */
export function trackCalls<T extends object>(kind: SettledWork, remote: T): T {
  if (!enabled) return remote;
  return new Proxy(remote, {
    get(target, name, receiver) {
      const value: unknown = Reflect.get(target, name, receiver);
      if (typeof name === 'symbol' || name === 'then' || typeof value !== 'function') return value;
      return (...args: unknown[]) => trackPending(kind, Promise.resolve((value as (...args: unknown[]) => unknown)(...args)));
    },
  });
}

/** Minimal shapes of the router and query client, so this module imports neither. */
interface RouterLike {
  state: { status: string; isLoading: boolean };
  subscribe(event: 'onBeforeLoad' | 'onRendered', listener: () => void): () => void;
}
interface QueryClientLike {
  isFetching(): number;
  isMutating(): number;
  getQueryCache(): { subscribe(listener: () => void): () => void };
  getMutationCache(): { subscribe(listener: () => void): () => void };
}

/** Counts a loading route and fetching queries or running mutations as pending, and their changes as changes. */
export function trackAppState(router: RouterLike, queryClient: QueryClientLike) {
  if (!enabled) return;
  probes.route = () => (router.state.status === 'pending' || router.state.isLoading ? 1 : 0);
  probes.query = () => queryClient.isFetching() + queryClient.isMutating();
  router.subscribe('onBeforeLoad', touch);
  router.subscribe('onRendered', touch);
  queryClient.getQueryCache().subscribe(touch);
  queryClient.getMutationCache().subscribe(touch);
}

/** The editor reported a new version of the design document. */
export function noteDocumentChange() {
  if (!enabled) return;
  revision++;
  touch();
}

export function settledSnapshot(): SettledSnapshot {
  return {
    load: performance.timeOrigin,
    revision,
    pending: { ...pending, route: probes.route(), query: probes.query(), frame: frame ? 1 : 0 },
  };
}

if (enabled) {
  window.__camncSettled = settledSnapshot;
  // Input is a change too: what it does is rendered on a later frame, even when it starts no tracked work.
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'keydown', 'keyup', 'wheel', 'input'])
    window.addEventListener(type, touch, { capture: true, passive: true });
}
