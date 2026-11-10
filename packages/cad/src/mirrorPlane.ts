import { cadDatumFrame } from './datumPlanes';
import { cadDrawnOnSupports, cadFaceFrame, effectivePlacement } from './drawnOn';
import { cadPartReference, cadPartReferenceOwner } from './partReferences';
import { CAD_IDENTITY_PLACEMENT, placePoint, rotateVector, type Vec3 } from './placement';
import type { CadDocument, CadPartCopy } from './types';

/** A mirror plane may belong to one physical copy, independently of its source family's other faces. */
export function cadMirrorPlaneFrame(document: CadDocument, mirror: NonNullable<CadPartCopy['mirror']>) {
  if (mirror.datum) return cadDatumFrame(document, mirror.datum);
  const on = mirror.across;
  if ('plane' in on) return cadFaceFrame(document, on);
  const part = cadPartReferenceOwner(document, on.partId);
  if (!part) return { error: 'That part is gone.' };
  const frame = cadFaceFrame(document, { ...on, partId: part.id });
  if ('error' in frame || part.id === on.partId) return frame;
  const copy = part.copies?.find(copy => cadPartReference(part.id, copy.id) === on.partId && !copy.suppressed);
  // A removed copy must never silently resolve to its source or a different pattern instance.
  if (!copy?.placement) return { error: 'That copy is gone or cannot be placed.' };
  const at = effectivePlacement(part, cadDrawnOnSupports(document)) ?? CAD_IDENTITY_PLACEMENT;
  const back = [-at.rotation[0], -at.rotation[1], -at.rotation[2], at.rotation[3]];
  const vector = (v: Vec3): Vec3 => {
    const local = rotateVector(back, v);
    if (copy.mirrored) local[0] *= -1;
    return rotateVector(copy.placement!.rotation, local);
  };
  const local = rotateVector(back, frame.origin.map((value, axis) => value - at.position[axis]!) as Vec3);
  if (copy.mirrored) local[0] *= -1;
  return {
    ...frame,
    origin: placePoint(copy.placement, local),
    x: vector(frame.x),
    y: vector(frame.y),
    normal: vector(frame.normal),
  };
}

/** Whether an edited mirror would depend on its own result, directly or through other copies. */
export function cadMirrorPlaneWouldCycle(
  document: CadDocument,
  partId: string,
  copyId: string,
  on: NonNullable<CadPartCopy['mirror']>['across']
) {
  const target = cadPartReference(partId, copyId);
  const visited = new Set<string>();
  let next = on;
  while ('partId' in next) {
    if (next.partId === target || visited.has(next.partId)) return true;
    visited.add(next.partId);
    const owner = cadPartReferenceOwner(document, next.partId);
    const reference = next.partId;
    const dependency = owner?.copies?.find(copy => cadPartReference(owner.id, copy.id) === reference)?.mirror;
    if (!dependency || dependency.datum) return false;
    next = dependency.across;
  }
  return false;
}
