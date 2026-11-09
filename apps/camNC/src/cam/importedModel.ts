import {
  detectFlat,
  extractFeatures,
  flatMatrix,
  flipPart,
  groupIdentical,
  kMaxSlopedShare,
  summarizePart,
  type BoardPartSource,
  type FlatPart,
  type PartFeatures,
  type StepBody,
} from '@wbcnc/cam';
import type { BodyMesh, CamPartInfo, ModelImport, Outline2D } from './camTypes';

/** A loaded part: its features, and those of its underside once turned over (side B), by turn axis. */
export interface ModelEntry {
  part: FlatPart;
  features: PartFeatures;
  flipped?: Partial<Record<'x' | 'y', PartFeatures>>;
  /** The bit diameter a native design relieved its inside corners for. */
  cornerRelief?: number;
}

/**
 * A STEP or STL file's bodies → flat parts, identical ones grouped, with feature summaries and display meshes, and
 * each part's features by id for planning (`partSource`). The CAM worker's import, and Node tests' too.
 */
export function modelOfBodies(bodies: StepBody[], readMs: number): { model: ModelImport; entries: Map<string, ModelEntry> } {
  const t0 = performance.now();
  const flat = bodies.map(b => detectFlat(b));
  const groups = groupIdentical(flat);
  const partOf = new Map<FlatPart, string>();
  const entries = new Map<string, ModelEntry>();
  const parts: CamPartInfo[] = groups.map((g, i) => {
    const id = `part-${i}`;
    g.members.forEach(part => partOf.set(part, id));
    const notFlat = g.part.slopedShare > kMaxSlopedShare;
    // 3D parts (350k triangles of knife slots take ~30s) are only analysed if milled anyway (see loadedPart()).
    const features = notFlat ? emptyFeatures(g.part) : extractFeatures(g.part.mesh, g.part.thickness);
    entries.set(id, { part: g.part, features });
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
    // A copy: the worker's transfer detaches it, and a 3D part milled anyway still needs its mesh (loadedPart()).
    indices: b.mesh.indices.slice(),
    flat: flatMatrix(flat[i]),
  }));
  return { model: { parts, meshes, readMs, analyzeMs: performance.now() - t0 }, entries };
}

/** A part of an imported model, ready to plan. */
export function loadedPart(entries: ReadonlyMap<string, ModelEntry> | undefined, partId: string) {
  const entry = entries?.get(partId);
  if (!entry) throw new Error('Open the model again: this part is not loaded.');
  // A 3D part milled as flat anyway: extract its features now.
  if (!entry.features.levels.length && entry.part.slopedShare > kMaxSlopedShare)
    entry.features = extractFeatures(entry.part.mesh, entry.part.thickness);
  return entry;
}

/** The parts of an imported model, with each one's turned-over features worked out once and kept. */
export function partSource(entries: ReadonlyMap<string, ModelEntry> | undefined): BoardPartSource {
  return {
    part: partId => {
      const entry = loadedPart(entries, partId);
      return { size: entry.part.size, features: entry.features, ...(entry.cornerRelief && { cornerRelief: entry.cornerRelief }) };
    },
    underside(partId, rotated) {
      const entry = loadedPart(entries, partId);
      const cache = (entry.flipped ??= {});
      const axis = rotated ? 'y' : 'x';
      return (cache[axis] ??= extractFeatures(flipPart(entry.part, axis).mesh, entry.part.thickness));
    },
  };
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
