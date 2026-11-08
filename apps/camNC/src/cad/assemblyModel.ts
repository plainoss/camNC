import { evaluateCadFeatures, evaluateCadPart, placementMatrix, type CadDocument, type CadPart, type CadPlacement } from '@wbcnc/cad';
import { Matrix4, Vector3 } from 'three';
import type { BodyMesh, CamPartInfo } from '@/cam/camTypes';
import { nativePart } from '@/cam/nativeCadModel';

/** Room left between parts that haven't been placed yet. */
const kGap = 40;

export interface AssemblyModel {
  /** In assembly space; each mesh's `flat` turns it back to lie on its underside, as CAM sees it. */
  meshes: BodyMesh[];
  parts: CamPartInfo[];
  /** Where every shown part sits, including those laid out because they haven't been placed. */
  placements: Map<string, CadPlacement>;
  /** Parts that can't be shown, and why. */
  problems: { partId: string; name: string; message: string }[];
}

/**
 * Every part as a mesh where it sits in the assembly. Parts without a placement lie flat in a row beside the placed
 * ones, so a new design shows something sensible before anything is placed.
 */
export function assemblyModel(document: CadDocument): AssemblyModel {
  type Built = { part: CadPart; problem: string } | ({ part: CadPart } & ReturnType<typeof nativePart>);
  const built = document.parts.map((part): Built => {
    const { part: profile } = evaluateCadPart(part);
    if (!profile) return { part, problem: 'Its sketch needs fixing first.' };
    try {
      return { part, ...nativePart(evaluateCadFeatures(part, profile).part) };
    } catch (cause) {
      return { part, problem: cause instanceof Error ? cause.message : String(cause) };
    }
  });
  // The local mesh starts at the outline's lower corner; this puts it back in sketch coordinates.
  const local = ([x, y]: [number, number] = [0, 0]) => new Matrix4().makeTranslation(x, y, 0);
  const placedRight = built.reduce((right, entry) => {
    if (!('mesh' in entry) || !entry.part.placement) return right;
    const matrix = new Matrix4().fromArray(placementMatrix(entry.part.placement)).multiply(local(entry.info.sourceOrigin));
    const v = new Vector3();
    for (let i = 0; i < entry.mesh.positions.length; i += 3)
      right = Math.max(right, v.fromArray(entry.mesh.positions, i).applyMatrix4(matrix).x);
    return right;
  }, -Infinity);
  let cursor = Number.isFinite(placedRight) ? placedRight + kGap : 0;
  const model: AssemblyModel = { meshes: [], parts: [], placements: new Map(), problems: [] };
  for (const entry of built) {
    if (!('mesh' in entry)) {
      model.problems.push({ partId: entry.part.id, name: entry.part.name, message: entry.problem });
      continue;
    }
    const placement: CadPlacement = entry.part.placement ?? {
      position: [cursor - (entry.info.sourceOrigin?.[0] ?? 0), 0 - (entry.info.sourceOrigin?.[1] ?? 0), 0],
      rotation: [0, 0, 0, 1],
    };
    if (!entry.part.placement) cursor += entry.info.size[0] + kGap;
    const matrix = new Matrix4().fromArray(placementMatrix(placement)).multiply(local(entry.info.sourceOrigin));
    const positions = entry.mesh.positions.slice(),
      v = new Vector3();
    for (let i = 0; i < positions.length; i += 3) v.fromArray(positions, i).applyMatrix4(matrix).toArray(positions, i);
    model.meshes.push({ ...entry.mesh, positions, flat: matrix.clone().invert().toArray() });
    model.parts.push(entry.info);
    model.placements.set(entry.part.id, placement);
  }
  return model;
}
