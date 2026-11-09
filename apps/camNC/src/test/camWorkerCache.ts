import type * as Comlink from 'comlink';
import type { ModelImport } from '../cam/camTypes';
import type { CamWorkerAPI } from '../workers/cam.worker';

type Worker = Comlink.Remote<CamWorkerAPI>;

/**
 * The CAM worker for browser route tests, with each result computed once per test file. Most tests open the same
 * STEP file as a new job: a new model key, so the real worker would read it and plan its boards again for each test,
 * and plans a test left running would hold up the next one. Here a file with the same bytes reuses the first read
 * (and the real worker's parts, under that first key), and a board or part already planned with the same request and
 * settings reuses that program. Results are copied out, so a test can't change what the next one gets.
 *
 * The results are the real worker's, from this run: route tests still check real CAM output, only not repeatedly.
 */
export function camWorkerCache(real: Worker): Worker {
  /** Per model key, the key the real worker has those parts under. */
  const canonical = new Map<string, string>();
  const reads = new Map<string, Promise<{ key: string; model: ModelImport }>>();
  const plans = new Map<string, Promise<unknown>>();
  const realKey = (key: string) => canonical.get(key) ?? key;
  const once = <T>(cache: Map<string, Promise<unknown>>, id: string, run: () => Promise<T>): Promise<T> => {
    let found = cache.get(id) as Promise<T> | undefined;
    if (!found) {
      found = run();
      cache.set(id, found);
      // A failure isn't kept: the next test asks again.
      found.catch(() => cache.delete(id));
    }
    return found.then(result => structuredClone(result));
  };

  const cached: Partial<CamWorkerAPI> = {
    async importModel(bytes, fileName, key = fileName) {
      const id = `${fileName}:${await digest(bytes)}`;
      let read = reads.get(id);
      if (!read) {
        read = Promise.resolve(real.importModel(bytes, fileName, key)).then(model => ({ key, model }));
        reads.set(id, read);
        read.catch(() => reads.delete(id));
      }
      const { key: first, model } = await read;
      canonical.set(key, first);
      return structuredClone(model);
    },
    async importDesign(...args) {
      canonical.delete(args[1]);
      return real.importDesign(...args);
    },
    generate: (key, partId, settings) =>
      once(plans, JSON.stringify(['part', realKey(key), partId, settings]), () =>
        Promise.resolve(real.generate(realKey(key), partId, settings))
      ),
    generateBoard: (key, board, settings, options, onProgress) =>
      once(plans, JSON.stringify(['board', realKey(key), board, settings, options ?? {}]), () =>
        Promise.resolve(real.generateBoard(realKey(key), board, settings, options, onProgress))
      ),
  };
  return new Proxy(real, {
    get: (target, name, receiver) => (name in cached ? cached[name as keyof CamWorkerAPI] : Reflect.get(target, name, receiver)),
  });
}

async function digest(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}
