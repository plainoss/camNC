import {
  evaluateCadFeatures,
  evaluateCadPart,
  evaluatedPartCopy,
  CAD_IDENTITY_PLACEMENT,
  placementMatrix,
  withPartCuts,
  cadDrawnOnSupports,
  cadCopyName,
  type CadDocument,
  type CadPart,
  type CadPlacement,
  type EvaluatedCadPart,
} from '@wbcnc/cad';
import { Matrix4, Vector3 } from 'three';
import type { BodyMesh, CamPartInfo } from '@/cam/camTypes';
import { nativePart } from '@/cam/nativeCadModel';

/** Room left between parts that haven't been placed yet. */
const kGap = 40;

/** One piece in the assembly: a part, or one of its copies. */
export interface AssemblyInstance {
  partId: string;
  copyId?: string;
  name: string;
}
/** How an instance is looked up in `placements`. */
export const instanceKey = ({ partId, copyId }: Pick<AssemblyInstance, 'partId' | 'copyId'>) => (copyId ? `${partId}/${copyId}` : partId);

export interface AssemblyModel {
  /** In assembly space; each mesh's `flat` turns it back to lie on its underside, as CAM sees it. */
  meshes: BodyMesh[];
  /** Which piece each mesh is, in the same order. */
  instances: AssemblyInstance[];
  parts: CamPartInfo[];
  /** Where every shown piece sits, including those laid out because they haven't been placed, by `instanceKey`. */
  placements: Map<string, CadPlacement>;
  /** Parts that can't be shown, and why. */
  problems: { partId: string; name: string; message: string }[];
}

/**
 * Every part and copy as a mesh where it sits in the assembly. Pieces without a placement lie flat in a row beside the
 * placed ones, so a new design shows something sensible before anything is placed.
 */
export function assemblyModel(document: CadDocument, hidden: ReadonlySet<string> = new Set()): AssemblyModel {
  type Shape = ReturnType<typeof nativePart>;
  type Built = { part: CadPart; problem: string } | { part: CadPart; shape: Shape; copies: Shape[] };
  const built = document.parts.map((part): Built => {
    const { part: profile } = evaluateCadPart(part);
    if (!profile) return { part, problem: 'Its sketch needs fixing first.' };
    try {
      const evaluated: EvaluatedCadPart = withPartCuts(document, evaluateCadFeatures(part, profile).part);
      const shape = nativePart(evaluated);
      // A copy is meshed on its own only when it's mirrored or cut differently; the rest share the part's mesh.
      let mirrored: Shape | undefined;
      const copies = (part.copies ?? []).map(copy => {
        if (evaluated.copyCuts?.[copy.id]) return nativePart(evaluatedPartCopy(evaluated, copy));
        if (copy.mirrored) return (mirrored ??= nativePart(evaluatedPartCopy(evaluated, copy)));
        return shape;
      });
      return { part, shape, copies };
    } catch (cause) {
      return { part, problem: cause instanceof Error ? cause.message : String(cause) };
    }
  });
  const pieces = built.flatMap(entry =>
    'shape' in entry
      ? [
          { instance: { partId: entry.part.id, name: entry.part.name }, placement: entry.part.placement, shape: entry.shape },
          ...(entry.part.copies ?? []).map((copy, index) => ({
            instance: { partId: entry.part.id, copyId: copy.id, name: cadCopyName(entry.part, index) },
            placement: copy.placement,
            shape: entry.copies[index]!,
          })),
        ]
      : []
  );
  // The local mesh starts at the outline's lower corner; this puts it back in sketch coordinates.
  const local = ([x, y]: [number, number] = [0, 0]) => new Matrix4().makeTranslation(x, y, 0);
  // A part others are drawn on stays where they were placed against it, at the origin, rather than in the row.
  const supports = cadDrawnOnSupports(document);
  for (const piece of pieces)
    if (!piece.placement && !('copyId' in piece.instance) && supports.has(piece.instance.partId)) piece.placement = CAD_IDENTITY_PLACEMENT;
  const placedRight = pieces.reduce((right, { placement, shape }) => {
    if (!placement) return right;
    const matrix = new Matrix4().fromArray(placementMatrix(placement)).multiply(local(shape.info.sourceOrigin));
    const v = new Vector3();
    for (let i = 0; i < shape.mesh.positions.length; i += 3)
      right = Math.max(right, v.fromArray(shape.mesh.positions, i).applyMatrix4(matrix).x);
    return right;
  }, -Infinity);
  let cursor = Number.isFinite(placedRight) ? placedRight + kGap : 0;
  const model: AssemblyModel = { meshes: [], instances: [], parts: [], placements: new Map(), problems: [] };
  for (const entry of built)
    if ('problem' in entry) model.problems.push({ partId: entry.part.id, name: entry.part.name, message: entry.problem });
  for (const { instance, placement: given, shape } of pieces) {
    const placement: CadPlacement = given ?? {
      position: [cursor - (shape.info.sourceOrigin?.[0] ?? 0), 0 - (shape.info.sourceOrigin?.[1] ?? 0), 0],
      rotation: [0, 0, 0, 1],
    };
    if (!given) cursor += shape.info.size[0] + kGap;
    // A hidden part keeps its place in the row, so showing it again doesn't move the others.
    if (hidden.has(instanceKey(instance))) continue;
    const matrix = new Matrix4().fromArray(placementMatrix(placement)).multiply(local(shape.info.sourceOrigin));
    const positions = shape.mesh.positions.slice(),
      v = new Vector3();
    for (let i = 0; i < positions.length; i += 3) v.fromArray(positions, i).applyMatrix4(matrix).toArray(positions, i);
    model.meshes.push({ ...shape.mesh, name: instance.name, positions, flat: matrix.clone().invert().toArray() });
    model.instances.push(instance);
    if (!model.parts.includes(shape.info)) model.parts.push(shape.info);
    model.placements.set(instanceKey(instance), placement);
  }
  return model;
}
