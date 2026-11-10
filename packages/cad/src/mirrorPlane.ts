import { isJoinedBody } from './extrudeSteps';
import { cadDatumFrame } from './datumPlanes';
import { cadDrawnOnSupports, cadFaceFrame, effectivePlacement } from './drawnOn';
import { cadPartReference, cadPartReferenceOwner } from './partReferences';
import { CAD_IDENTITY_PLACEMENT, placePoint, rotateVector, type Vec3 } from './placement';
import type { CadDocument, CadPartCopy } from './types';

/** A joined body inherits its parent's copy ID and transform, as the assembled viewport does. */
export function cadMirrorFaceCopy(document: CadDocument, reference: string) {
  const source = cadPartReferenceOwner(document, reference);
  if (!source || source.id === reference) return null;
  const own = source.copies?.find(copy => cadPartReference(source.id, copy.id) === reference && !copy.suppressed);
  if (own) return { part: source, copy: own, mirrored: !!own.mirrored };
  const parent = isJoinedBody(document, source) && document.parts.find(part => part.id === source.addTo);
  const inherited = parent && parent.copies?.find(copy => cadPartReference(source.id, copy.id) === reference && !copy.suppressed);
  // Inherited bodies are rendered with the parent's rigid transform; their mesh is not reflected in local x.
  return parent && inherited ? { part: parent, copy: inherited, mirrored: false } : null;
}

/** A mirror plane may belong to one physical copy, independently of its source family's other faces. */
export function cadMirrorPlaneFrame(document: CadDocument, mirror: NonNullable<CadPartCopy['mirror']>) {
  if (mirror.datum) return cadDatumFrame(document, mirror.datum);
  const on = mirror.across;
  if ('plane' in on) return cadFaceFrame(document, on);
  const reference = cadPartReference(on.partId, on.copyId);
  const part = cadPartReferenceOwner(document, reference);
  if (!part) return { error: 'That part is gone.' };
  const frame = cadFaceFrame(document, { partId: part.id, face: on.face });
  if ('error' in frame || part.id === reference) return frame;
  const instance = cadMirrorFaceCopy(document, reference);
  const copy = instance?.copy;
  // A removed copy must never silently resolve to its source or a different pattern instance.
  if (!copy?.placement) return { error: 'That copy is gone or cannot be placed.' };
  const at = effectivePlacement(instance!.part, cadDrawnOnSupports(document)) ?? CAD_IDENTITY_PLACEMENT;
  const back = [-at.rotation[0], -at.rotation[1], -at.rotation[2], at.rotation[3]];
  const vector = (v: Vec3): Vec3 => {
    const local = rotateVector(back, v);
    if (instance!.mirrored) local[0] *= -1;
    return rotateVector(copy.placement!.rotation, local);
  };
  const local = rotateVector(back, frame.origin.map((value, axis) => value - at.position[axis]!) as Vec3);
  if (instance!.mirrored) local[0] *= -1;
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
    const reference = cadPartReference(next.partId, next.copyId);
    if (reference === target || visited.has(reference)) return true;
    visited.add(reference);
    const instance = cadMirrorFaceCopy(document, reference);
    if (instance && cadPartReference(instance.part.id, instance.copy.id) === target) return true;
    const dependency = instance?.copy.mirror;
    if (!dependency || dependency.datum) return false;
    next = dependency.across;
  }
  return false;
}
