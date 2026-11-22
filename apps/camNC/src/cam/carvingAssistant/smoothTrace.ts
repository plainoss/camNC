import { t as translate, workerLanguageName } from '@wbcnc/i18n';
export interface SmoothTrace {
  d: string;
  curves: number;
  lines: number;
  components: number;
  holes: number;
  outline: { x: number; y: number }[][];
  roundRegularized: boolean;
}

/** Disposable, offline curve fitter: cancellation and the deadline can interrupt synchronous tracing. */
export function smoothTrace(
  ink: Uint8Array,
  width: number,
  height: number,
  tolerancePx: number,
  chordTolerancePx: number,
  signal?: AbortSignal,
  microCornerSpanPx = 0
): Promise<SmoothTrace> {
  if (signal?.aborted) return Promise.reject(new DOMException(translate('Raster tracing stopped.'), 'AbortError'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./smoothTrace.worker.ts', import.meta.url), { type: 'module', name: workerLanguageName() });
    let done = false;
    const finish = (result?: SmoothTrace, error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', stopped);
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const stopped = () => finish(undefined, new DOMException(translate('Raster tracing stopped.'), 'AbortError'));
    const timer = setTimeout(
      () => finish(undefined, new Error(translate('Smooth tracing exceeded 15 seconds. Use simpler artwork.'))),
      15_000
    );
    signal?.addEventListener('abort', stopped, { once: true });
    worker.onmessage = (event: MessageEvent<SmoothTrace & { error?: string }>) =>
      event.data.error ? finish(undefined, new Error(event.data.error)) : finish(event.data);
    worker.onerror = () => finish(undefined, new Error(translate('The smooth tracing worker failed.')));
    worker.postMessage({ ink, width, height, tolerancePx, chordTolerancePx, microCornerSpanPx });
  });
}
