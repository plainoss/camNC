/**
 * Whether the app has caught up with what was last done to it, for behaviour specs and browser tests. Dev and test
 * builds only: in a production build every function here is a no-op and nothing is put on `window`.
 *
 * `window.__camncSettled()` returns a snapshot. The app has settled when every pending count is zero:
 * - `solve`: sketch solver calls in flight (checks, drags, dimension preparation, acceptance).
 * - `worker`: CAM worker calls in flight (imports, the Part Studio's model, part and board plans).
 * - `save`: IndexedDB writes and queued design draft saves not yet finished.
 * - `animation`: a camera move that does something when it ends (turning to a face before sketching on it).
 * - `assistant`: a design assistant turn running (reading the design, waiting for the reply, checking a script).
 * - `route`: a navigation still loading its route.
 * - `query`: data queries fetching and mutations running (reading a job, saving boards).
 * - `render`: 3D views not yet drawn, or with a frame requested and not yet drawn (`settledCanvas.ts`).
 * - `frame`: 1 until two animation frames have passed since the last input event or change to any of the above, so
 *   React has rendered what that input or result changed (a 3D view's separate overlay root included).
 *
 * `revision` counts the design document changes the editor has reported since this page loaded, and `load` tells
 * page loads apart, so a caller can tell a change made after it looked from one made before.
 */

export type SettledWork = 'solve' | 'worker' | 'save' | 'animation' | 'assistant';
export type SettledProbe = 'route' | 'query' | 'render';
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
const idle = () => 0;
const pending: Record<SettledWork, number> = { solve: 0, worker: 0, save: 0, animation: 0, assistant: 0 };
const probes: Record<SettledProbe, () => number> = { route: idle, query: idle, render: idle };
/** What the probes said when last asked: a probe whose count changes is a change, like work that ends. */
let probed: Record<SettledProbe, number> = { route: 0, query: 0, render: 0 };
const unsubscribe: (() => void)[] = [];
/** Bumped by resetSettled: work started before it no longer counts when it ends. */
let generation = 0;
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
  const started = generation;
  const done = () => {
    if (started === generation) pending[kind]--;
    touch();
  };
  work.then(done, done);
  return work;
}

/** Counts one pending `kind` until the returned function is first called, as an effect's cleanup can. */
export function holdPending(kind: SettledWork): () => void {
  let release!: () => void;
  void trackPending(kind, new Promise<void>(resolve => (release = resolve)));
  return () => release();
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

/** Counts a loading route as pending, and its changes as changes. */
export function trackRouter(router: RouterLike) {
  if (!enabled) return;
  probes.route = () => (router.state.status === 'pending' || router.state.isLoading ? 1 : 0);
  unsubscribe.push(router.subscribe('onBeforeLoad', touch), router.subscribe('onRendered', touch));
}

/** Counts fetching queries and running mutations as pending, and their changes as changes. The last client wins. */
export function trackQueryClient(queryClient: QueryClientLike) {
  if (!enabled) return;
  probes.query = () => queryClient.isFetching() + queryClient.isMutating();
  unsubscribe.push(queryClient.getQueryCache().subscribe(touch), queryClient.getMutationCache().subscribe(touch));
}

/** Counts a loading route and fetching queries or running mutations as pending, and their changes as changes. */
export function trackAppState(router: RouterLike, queryClient: QueryClientLike) {
  trackRouter(router);
  trackQueryClient(queryClient);
}

/** Counts what `probe` returns as pending `kind`, asked on every snapshot. */
export function trackProbe(kind: 'render', probe: () => number) {
  if (enabled) probes[kind] = probe;
}

/**
 * Forgets the routers, query clients and work counted so far, for browser tests (`src/test/settledReset.ts`): a test's
 * unmounted page or a call it left running must not count against the next test. Work started before still running
 * no longer counts when it ends. Probes set by `trackProbe` read the page itself, so they stay.
 */
export function resetSettled() {
  generation++;
  for (const kind of Object.keys(pending) as SettledWork[]) pending[kind] = 0;
  for (const stop of unsubscribe.splice(0)) stop();
  probes.route = idle;
  probes.query = idle;
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
}

/** The editor reported a new version of the design document. */
export function noteDocumentChange() {
  if (!enabled) return;
  revision++;
  touch();
}

export function settledSnapshot(): SettledSnapshot {
  const now = { route: probes.route(), query: probes.query(), render: probes.render() };
  if (Object.entries(now).some(([kind, count]) => probed[kind as SettledProbe] !== count)) touch();
  probed = now;
  return { load: performance.timeOrigin, revision, pending: { ...pending, ...now, frame: frame ? 1 : 0 } };
}

if (enabled) {
  window.__camncSettled = settledSnapshot;
  // Input is a change too: what it does is rendered on a later frame, even when it starts no tracked work.
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'keydown', 'keyup', 'wheel', 'input'])
    window.addEventListener(type, touch, { capture: true, passive: true });
}
