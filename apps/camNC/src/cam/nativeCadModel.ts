import { cadPartsToCut, solveCadDocument, type CadDocument, type EvaluatedCadPart } from '@wbcnc/cad';
import { profileFeatures, summarizePart, type FlatPart, type PartFeatures } from '@wbcnc/cam';
import { ExtrudeGeometry, Path, Shape, Vector2 } from 'three';
import type { BodyMesh, CamPartInfo, ModelImport, Outline2D } from './camTypes';
import { cutPartMesh } from './cutPartMesh';
import { asMilled } from './millSide';

export interface NativeCadEntry {
  part: FlatPart;
  features: PartFeatures;
  /** Side B's features for each way the part can turn over, when it has cuts from below. */
  flipped?: { x?: PartFeatures; y?: PartFeatures };
  /** The bit diameter the design relieved its inside corners for. */
  cornerRelief?: number;
}

/** Native curves are tessellated once by CAD, then go straight to CAM's polygon feature seam. */
export function nativePart(source: EvaluatedCadPart): { entry: NativeCadEntry; info: CamPartInfo; mesh: BodyMesh } {
  const { features, below, turned, holeSources, offset, size, problem } = profileFeatures(source);
  if (problem) throw new Error(`${source.name}: ${problem}`);
  const outer = features.outlines[0]!;
  const holeLoops = source.loops.filter(loop => loop.kind === 'hole').map(loop => loop.id);
  let positions: Float64Array, indices: Uint32Array;
  if (source.cuts?.length) ({ positions, indices } = cutPartMesh(features, below ?? undefined));
  else {
    const shape = new Shape(outer.map(p => new Vector2(p.x, p.y)));
    shape.holes.push(...features.throughHoles.map(h => new Path(h.map(p => new Vector2(p.x, p.y)))));
    const geometry = new ExtrudeGeometry(shape, { depth: source.thickness, bevelEnabled: false, curveSegments: 4 });
    positions = Float64Array.from(geometry.getAttribute('position').array);
    indices = geometry.index ? Uint32Array.from(geometry.index.array) : Uint32Array.from({ length: positions.length / 3 }, (_, i) => i);
    geometry.dispose();
  }
  const part: FlatPart = {
    name: source.name,
    size,
    thickness: source.thickness,
    mesh: { positions, indices, faceRanges: [] },
    axes: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    origin: [0, 0, 0],
    topFeatureArea: features.pockets.reduce((sum, pocket) => sum + pocket.area, 0),
    bottomFeatureArea: below ? below.pockets.reduce((sum, pocket) => sum + pocket.area, 0) : 0,
    flipped: false,
    prismaticRatio: 1,
    slopedShare: 0,
    slopedArea: 0,
  };
  const paths = (loops: { x: number; y: number }[][]): Outline2D => loops.map(loop => loop.map(p => [p.x, p.y]));
  return {
    entry: { part, features, ...(turned && { flipped: { x: turned('x'), y: turned('y') } }) },
    info: {
      id: source.partId,
      holeIds: holeSources ? holeSources.map(from => ('hole' in from ? holeLoops[from.hole]! : from.cut)) : holeLoops,
      sourceOrigin: [offset.x, offset.y],
      name: source.name,
      modelName: source.name,
      names: [source.name],
      size,
      thickness: source.thickness,
      summary: summarizePart(part, features),
      shape: {
        outlines: paths(features.outlines),
        holes: paths(features.throughHoles),
        pockets: features.pockets.map(pocket => ({ depth: source.thickness - pocket.floorZ, region: paths(pocket.strictRegion) })),
      },
    },
    mesh: {
      name: source.name,
      partId: source.partId,
      positions: Float32Array.from(positions),
      indices: indices.slice(),
      flat: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    },
  };
}

export async function nativeCadModel(document: CadDocument): Promise<{ model: ModelImport; entries: Map<string, NativeCadEntry> }> {
  const started = performance.now();
  const solved = await solveCadDocument(document);
  if (solved.status !== 'solved') throw new Error(solved.diagnostics.map(d => d.message).join(' ') || 'The design could not be solved.');
  const parts = cadPartsToCut(solved.document, solved.parts).map(({ part, names }) => {
    const native = nativePart(asMilled(part));
    native.info.names = names;
    // A mirrored copy is cut as a part of its own, relieved like the part it mirrors.
    const relief = solved.document.parts.find(source => part.partId.split(':')[0] === source.id)?.cornerRelief;
    if (relief) native.entry.cornerRelief = relief.diameter;
    return native;
  });
  return {
    entries: new Map(parts.map(p => [p.info.id, p.entry])),
    model: { parts: parts.map(p => p.info), meshes: parts.map(p => p.mesh), readMs: 0, analyzeMs: performance.now() - started },
  };
}
