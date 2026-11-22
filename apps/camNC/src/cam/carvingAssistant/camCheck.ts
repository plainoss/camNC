import { t as translate, workerLanguageName } from '@wbcnc/i18n';
import type { BoardCarving, Operation } from '@wbcnc/cam';

/** Disposable worker: Stop terminates even a synchronous polygon-offset/CAM operation. */
export function checkCarvingInWorker(carving: BoardCarving, thickness: number, signal?: AbortSignal): Promise<Operation[]> {
  if (signal?.aborted) return Promise.reject(new DOMException(translate('Artwork preparation stopped.'), 'AbortError'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./camCheck.worker.ts', import.meta.url), { type: 'module', name: workerLanguageName() });
    let settled = false;
    const finish = (operations?: Operation[], error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', stopped);
      worker.terminate();
      if (error) reject(error);
      else resolve(operations ?? []);
    };
    const stopped = () => finish(undefined, new DOMException(translate('Artwork preparation stopped.'), 'AbortError'));
    const timer = setTimeout(
      () => finish(undefined, new Error(translate('The carving check exceeded 30 seconds. Use simpler artwork.'))),
      30_000
    );
    signal?.addEventListener('abort', stopped, { once: true });
    worker.onmessage = (event: MessageEvent<{ operations?: Operation[]; error?: string }>) => {
      if (event.data.error) finish(undefined, new Error(event.data.error));
      else finish(event.data.operations);
    };
    worker.onerror = () => finish(undefined, new Error(translate('The carving check worker failed.')));
    try {
      worker.postMessage({ carving, thickness });
    } catch (error) {
      finish(undefined, error instanceof Error ? error : new Error(translate('The carving check could not start.')));
    }
  });
}
