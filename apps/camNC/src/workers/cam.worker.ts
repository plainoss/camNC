import { loadStep, loadStl, planBoard, type CamSettings, type OnProgress, type StepBody } from '@wbcnc/cam';
import * as Comlink from 'comlink';
// Lazy: this worker only starts when a model is opened, and occt only loads the wasm on the first STEP file.
import occtWasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url';
import type { BoardRequest, ModelImport, PlanResult } from '../cam/camTypes';
import type { CadDocument } from '@wbcnc/cad';
import { nativeCadModel } from '../cam/nativeCadModel';
import { modelOfBodies, partSource, type ModelEntry } from '../cam/importedModel';

/** Parts of the models imported in this worker, by model key, so generating G-code needs no re-import. */
const models = new Map<string, Map<string, ModelEntry>>();

async function readBodies(bytes: Uint8Array, fileName: string): Promise<{ bodies: StepBody[]; readMs: number }> {
  if (/\.stl$/i.test(fileName)) {
    const t0 = performance.now();
    const bodies = loadStl(bytes, fileName.replace(/\.stl$/i, ''));
    return { bodies, readMs: performance.now() - t0 };
  }
  return loadStep(bytes, { locateFile: () => occtWasmUrl });
}

const api = {
  /** Native design -> exact solved profiles, without STEP serialization or mesh feature extraction. */
  async importDesign(document: CadDocument, key: string): Promise<ModelImport> {
    const { model, entries } = await nativeCadModel(document);
    models.set(key, entries);
    return Comlink.transfer(
      model,
      model.meshes.flatMap(m => [m.positions.buffer as ArrayBuffer, m.indices.buffer as ArrayBuffer])
    );
  },
  /** STEP or STL → flat parts, identical ones grouped, with feature summaries and display meshes. */
  async importModel(bytes: Uint8Array, fileName: string, key = fileName): Promise<ModelImport> {
    const { bodies, readMs } = await readBodies(bytes, fileName);
    const { model, entries } = modelOfBodies(bodies, readMs);
    models.set(key, entries);
    return Comlink.transfer(
      model,
      model.meshes.flatMap(m => [m.positions.buffer as ArrayBuffer, m.indices.buffer as ArrayBuffer])
    );
  },

  /** One program for a whole board: its parts at their nested positions, operations grouped by bit. */
  async generateBoard(
    key: string,
    board: BoardRequest,
    settings: Partial<CamSettings>,
    options: { perPart?: boolean } = {},
    onProgress?: OnProgress
  ): Promise<PlanResult> {
    try {
      return planBoard(board, settings, partSource(models.get(key)), { ...options, onProgress: onProgress && throttled(onProgress) });
    } finally {
      // The page's end of the callback stays open until it's let go.
      (onProgress as Comlink.Remote<OnProgress> | undefined)?.[Comlink.releaseProxy]();
    }
  },
};

/** Progress to the page at most every 100 ms: each report is a message, and a plan can make thousands. 0 always goes. */
function throttled(onProgress: OnProgress): OnProgress {
  let last = -Infinity;
  return fraction => {
    const now = performance.now();
    if (fraction > 0 && now - last < 100) return;
    last = now;
    void onProgress(fraction);
  };
}

export type CamWorkerAPI = typeof api;
Comlink.expose(api);
