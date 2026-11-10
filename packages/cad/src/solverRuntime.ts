import { init_planegcs_module, type GcsWrapper, type ModuleStatic } from '@salusoft89/planegcs';
import bundledWasmUrl from './wasmAsset';

export const cadSolverRuntime: { promise?: Promise<ModuleStatic>; module?: ModuleStatic } = {};
export const poisonedModules = new WeakSet<ModuleStatic>();

/** Optional explicit asset URL for hosts without Vite. WASM is bundled and runs locally. */
export async function initializeCadSolver(wasmUrl?: string): Promise<void> {
  if (!cadSolverRuntime.promise) {
    const opening = (async () => {
      const isNode = typeof process !== 'undefined' && !!process.versions?.node;
      const url = wasmUrl ?? (isNode ? undefined : bundledWasmUrl);
      const module = await init_planegcs_module(url ? { locateFile: () => url } : undefined);
      // An aborted Emscripten heap must never be reused, including by synchronous script queries.
      (module as ModuleStatic & { onAbort?: (reason: unknown) => void }).onAbort = () => {
        poisonedModules.add(module);
        if (cadSolverRuntime.promise === opening) {
          cadSolverRuntime.promise = undefined;
          cadSolverRuntime.module = undefined;
        }
      };
      cadSolverRuntime.module = module;
      return module;
    })();
    cadSolverRuntime.promise = opening;
    opening.catch(() => {
      if (cadSolverRuntime.promise === opening) {
        cadSolverRuntime.promise = undefined;
        cadSolverRuntime.module = undefined;
      }
    });
  }
  await cadSolverRuntime.promise;
}

export function destroyCadSolverWrapper(wrapper: GcsWrapper): void {
  // After a native trap/abort, release the whole module instead of calling back into its heap.
  if (wrapper.module && poisonedModules.has(wrapper.module)) return;
  // The upstream wrapper keeps BSpline geometries alive for constraint reuse; release
  // our cache explicitly after their copied native constraints have been cleared.
  wrapper.gcs.clear_data();
  for (const curve of wrapper.bspline_gcs_cache.values()) curve.delete();
  wrapper.bspline_gcs_cache.clear();
  wrapper.destroy_gcs_module();
}
