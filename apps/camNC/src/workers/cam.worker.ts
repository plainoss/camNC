import {
  camPart,
  detectFlat,
  extractFeatures,
  flatMatrix,
  flipPart,
  groupIdentical,
  kMaxSlopedShare,
  loadStep,
  loadStl,
  planBoard,
  summarizePart,
  summarizePlan,
  type BoardPartSource,
  type CamSettings,
  type FlatPart,
  type OnProgress,
  type PartFeatures,
  type StepBody,
} from '@wbcnc/cam';
import * as Comlink from 'comlink';
// Lazy: this worker only starts when a model is opened, and occt only loads the wasm on the first STEP file.
import occtWasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url';
import type { BoardRequest, BodyMesh, CamPartInfo, ModelImport, Outline2D, PlanResult } from '../cam/camTypes';
import type { CadDocument } from '@wbcnc/cad';
import { nativeCadModel } from '../cam/nativeCadModel';

/** Parts of the models imported in this worker, by model key, so generating G-code needs no re-import. */
/** A loaded part: its features, and those of its underside once turned over (side B), by turn axis. */
interface ModelEntry {
  part: FlatPart;
  features: PartFeatures;
  flipped?: Partial<Record<'x' | 'y', PartFeatures>>;
  /** The bit diameter a native design relieved its inside corners for. */
  cornerRelief?: number;
}
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
  async importDesign(document: CadDocument, key: string, options?: { turnUndersideUp?: boolean }): Promise<ModelImport> {
    const { model, entries } = await nativeCadModel(document, options);
    models.set(key, entries);
    return Comlink.transfer(
      model,
      model.meshes.flatMap(m => [m.positions.buffer as ArrayBuffer, m.indices.buffer as ArrayBuffer])
    );
  },
  /** STEP or STL → flat parts, identical ones grouped, with feature summaries and display meshes. */
  async importModel(bytes: Uint8Array, fileName: string, key = fileName): Promise<ModelImport> {
    const { bodies, readMs } = await readBodies(bytes, fileName);
    const t0 = performance.now();
    const flat = bodies.map(b => detectFlat(b));
    const groups = groupIdentical(flat);
    const partOf = new Map<FlatPart, string>();
    const cache = new Map<string, ModelEntry>();
    models.set(key, cache);
    const parts: CamPartInfo[] = groups.map((g, i) => {
      const id = `part-${i}`;
      g.members.forEach(part => partOf.set(part, id));
      const notFlat = g.part.slopedShare > kMaxSlopedShare;
      // 3D parts (350k triangles of knife slots take ~30s) are only analysed if milled anyway (see loaded()).
      const features = notFlat ? emptyFeatures(g.part) : extractFeatures(g.part.mesh, g.part.thickness);
      cache.set(id, { part: g.part, features });
      const summary = summarizePart(g.part, features);
      const shape = (paths: { x: number; y: number }[][]): Outline2D => paths.map(p => p.map(q => [+q.x.toFixed(2), +q.y.toFixed(2)]));
      return {
        id,
        name: g.names[0],
        names: g.names,
        size: g.part.size,
        thickness: g.part.thickness,
        summary,
        shape: {
          outlines: shape(features.outlines),
          holes: shape(features.throughHoles),
          pockets: features.pockets.map(p => ({ depth: g.part.thickness - p.floorZ, region: shape(p.strictRegion) })),
        },
      };
    });
    const meshes: BodyMesh[] = bodies.map((b, i) => ({
      name: b.name,
      partId: partOf.get(flat[i]) ?? parts[0].id,
      positions: Float32Array.from(b.mesh.positions),
      // A copy: the transfer detaches it, and a 3D part milled anyway still needs its mesh here (loaded()).
      indices: b.mesh.indices.slice(),
      flat: flatMatrix(flat[i]),
    }));
    const result: ModelImport = { parts, meshes, readMs, analyzeMs: performance.now() - t0 };
    return Comlink.transfer(
      result,
      meshes.flatMap(m => [m.positions.buffer as ArrayBuffer, m.indices.buffer as ArrayBuffer])
    );
  },

  /** Toolpaths and FluidNC G-code for one part of an imported model, with per-operation numbers and safety checks. */
  async generate(key: string, partId: string, settings: Partial<CamSettings>): Promise<PlanResult> {
    const { part, features } = loaded(key, partId);
    const cam = camPart(features, settings);
    return summarizePlan(cam, part.name, part.size, settings);
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
      return planBoard(board, settings, partSource(key), { ...options, onProgress: onProgress && throttled(onProgress) });
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

/** The parts of an imported model, with each one's turned-over features worked out once and kept. */
function partSource(key: string): BoardPartSource {
  return {
    part: partId => {
      const entry = loaded(key, partId);
      return { size: entry.part.size, features: entry.features, ...(entry.cornerRelief && { cornerRelief: entry.cornerRelief }) };
    },
    underside(partId, rotated) {
      const entry = loaded(key, partId);
      const cache = (entry.flipped ??= {});
      const axis = rotated ? 'y' : 'x';
      return (cache[axis] ??= extractFeatures(flipPart(entry.part, axis).mesh, entry.part.thickness));
    },
  };
}

function loaded(key: string, partId: string) {
  const entry = models.get(key)?.get(partId);
  if (!entry) throw new Error('Open the model again: this part is not loaded.');
  // A 3D part milled as flat anyway: extract its features now.
  if (!entry.features.levels.length && entry.part.slopedShare > kMaxSlopedShare)
    entry.features = extractFeatures(entry.part.mesh, entry.part.thickness);
  return entry;
}

function emptyFeatures(part: FlatPart): PartFeatures {
  return {
    thickness: part.thickness,
    footprint: [],
    outlines: [],
    throughHoles: [],
    levels: [],
    pockets: [],
    bottomFaces: [],
    slopedArea: 0,
  };
}

export type CamWorkerAPI = typeof api;
Comlink.expose(api);
