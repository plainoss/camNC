import {
  evaluateCadPartFamily,
  evaluateCadPart,
  evaluatedPartCopy,
  CAD_IDENTITY_PLACEMENT,
  placementMatrix,
  withPartCuts,
  cadDrawnOnSupports,
  cadCopyName,
  resolveDrawnPlacements,
  activeDesign,
  resolveDatumPlanes,
  isCadBody,
  isJoinedBody,
  consumedTools,
  physicalJoinedCopies,
  type CadDocument,
  type CadPart,
  type CadPlacement,
} from '@wbcnc/cad';
import { Matrix4, Vector3 } from 'three';
import type { BodyMesh, CamPartInfo } from '@/cam/camTypes';
import { nativePart } from '@/cam/nativeCadModel';
<<<<<<< HEAD
import { studioGeometry } from './studioGeometry';
=======
>>>>>>> 346bcfcf51c8d7439e0581f9b3840ddc5d4af851
import { assemblyDisplayPlacements } from './assemblyDisplayPlacements';

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
export function assemblyModel(given: CadDocument, hidden: ReadonlySet<string> = new Set()): AssemblyModel {
  // Where each part drawn on a plane or face is, from that face as it is now: a step changed without solving, such as a
  // thickness in the Extrude dialog, would otherwise leave the parts on it where it used to be.
<<<<<<< HEAD
  const geometry = studioGeometry(given);
  const document = geometry.parts ? geometry.document : resolveDrawnPlacements(resolveDatumPlanes(activeDesign(given))).document;
=======
  // Inherited material uses the ordinary copy path so its reflected contours and instance-specific cuts stay visible.
  const document = physicalJoinedCopies(resolveDrawnPlacements(resolveDatumPlanes(activeDesign(given))).document);
>>>>>>> 346bcfcf51c8d7439e0581f9b3840ddc5d4af851
  type Shape = ReturnType<typeof nativePart>;
  type Built = { part: CadPart; problem: string } | { part: CadPart; shape: Shape; copies: Shape[] };
  // A sketch not yet extruded has nothing to show in 3D.
  // Bodies joined to a part by Extrude → Add are built as it is; a tool used up by a cut is only the cut it made.
  const consumed = consumedTools(document);
  const built = document.parts
    .filter(part => isCadBody(document, part) && !consumed.has(part.id))
    .map((part): Built => {
      try {
        const profile = geometry.parts ? undefined : evaluateCadPart(part).part;
        const evaluated =
          geometry.parts?.find(shape => shape.partId === part.id) ??
          (profile && withPartCuts(document, evaluateCadPartFamily(part, profile).part));
        if (!evaluated) return { part, problem: 'Its sketch needs fixing first.' };
        const shape = nativePart(evaluated);
        // A copy is meshed on its own only when it's mirrored or cut differently; the rest share the part's mesh.
        let mirrored: Shape | undefined;
        const copies = (part.copies ?? []).map(copy => {
          if (evaluated.copyCuts?.[copy.id] || evaluated.copyProfiles?.[copy.id]) return nativePart(evaluatedPartCopy(evaluated, copy));
          if (copy.mirrored) return (mirrored ??= nativePart(evaluatedPartCopy(evaluated, copy)));
          return shape;
        });
        return { part, shape, copies };
      } catch (cause) {
        return { part, problem: cause instanceof Error ? cause.message : String(cause) };
      }
    });
  const byId = new Map(document.parts.map(part => [part.id, part]));
<<<<<<< HEAD
  /** A body joined to a part goes with each copy of it, where the copy is as the body is to the part. */
  const withParentCopies = (part: CadPart, shape: Shape) => {
    // Ordered geometry already includes these exact inherited instances in the shared physical view.
    if (geometry.parts) return [];
    const parent = isJoinedBody(document, part) ? byId.get(part.addTo!) : undefined;
    if (!parent?.placement || !part.placement) return [];
    const relative = new Matrix4()
      .fromArray(placementMatrix(parent.placement))
      .invert()
      .multiply(new Matrix4().fromArray(placementMatrix(part.placement)));
    return (parent.copies ?? []).flatMap((copy, index) => {
      if (!copy.placement) return [];
      const matrix = new Matrix4().fromArray(placementMatrix(copy.placement)).multiply(relative);
      const position = new Vector3(),
        rotation = new Quaternion();
      matrix.decompose(position, rotation, new Vector3());
      return [
        {
          instance: { partId: part.id, copyId: copy.id, name: `${part.name} · ${cadCopyName(parent, index)}` },
          placement: { position: position.toArray(), rotation: rotation.toArray() } as CadPlacement,
          shape,
        },
      ];
    });
  };
=======
>>>>>>> 346bcfcf51c8d7439e0581f9b3840ddc5d4af851
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
  /** A joined body is hidden with the part, or the copy of it, that it's joined to. */
  const isHidden = (instance: { partId: string; copyId?: string }) => {
    if (hidden.has(instanceKey(instance))) return true;
    const part = byId.get(instance.partId);
    return !!part && isJoinedBody(document, part) && hidden.has(instanceKey({ partId: part.addTo!, copyId: instance.copyId }));
  };
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
<<<<<<< HEAD
  const rowStart = Number.isFinite(placedRight) ? placedRight + kGap : 0;
  const displayPlacements = assemblyDisplayPlacements(
    document,
    geometry.source,
    pieces.map(piece => ({
      ...piece,
      origin: piece.shape.info.sourceOrigin,
      width: piece.shape.info.size[0],
    })),
    rowStart,
=======
  const displayPlacements = assemblyDisplayPlacements(
    document,
    given,
    pieces.map(piece => ({ ...piece, origin: piece.shape.info.sourceOrigin, width: piece.shape.info.size[0] })),
    Number.isFinite(placedRight) ? placedRight + kGap : 0,
>>>>>>> 346bcfcf51c8d7439e0581f9b3840ddc5d4af851
    kGap
  );
  const model: AssemblyModel = { meshes: [], instances: [], parts: [], placements: new Map(), problems: [] };
  model.problems.push(
    ...geometry.diagnostics.map(diagnostic => ({
      partId: diagnostic.partId ?? given.id,
      name: given.parts.find(part => part.id === diagnostic.partId)?.name ?? given.name,
      message: diagnostic.message,
    }))
  );
  for (const entry of built)
    if ('problem' in entry) model.problems.push({ partId: entry.part.id, name: entry.part.name, message: entry.problem });
  for (const { instance, shape } of pieces) {
    const placement = displayPlacements.get(instanceKey(instance))!;
    // A hidden part keeps its place in the row, so showing it again doesn't move the others.
    if (isHidden(instance)) continue;
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
