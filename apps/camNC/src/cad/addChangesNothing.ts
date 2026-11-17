import type { CadDocument, CadPart } from '@wbcnc/cad';
import type { BufferGeometry } from 'three';
import { partSolid } from './partSolid';

/** The volume a closed mesh holds. */
export function meshVolume(geometry: BufferGeometry): number {
  const positions = geometry.getAttribute('position'),
    indices = geometry.index;
  let sum = 0;
  for (let i = 0; i < (indices?.count ?? positions.count); i += 3) {
    const a = indices ? indices.getX(i) : i,
      b = indices ? indices.getX(i + 1) : i + 1,
      c = indices ? indices.getX(i + 2) : i + 2;
    sum +=
      positions.getX(a) * (positions.getY(b) * positions.getZ(c) - positions.getZ(b) * positions.getY(c)) +
      positions.getY(a) * (positions.getZ(b) * positions.getX(c) - positions.getX(b) * positions.getZ(c)) +
      positions.getZ(a) * (positions.getX(b) * positions.getY(c) - positions.getY(b) * positions.getX(c));
  }
  return Math.abs(sum / 6);
}

/**
 * Whether the Add `part` leaves the part it merges into as it was: the added body lies wholly inside it, or the two
 * don't meet. The step is still valid; it just changes nothing.
 */
export function addChangesNothing(document: CadDocument, part: CadPart): boolean {
  const target = part.addTo ? document.parts.find(candidate => candidate.id === part.addTo) : undefined;
  if (!target) return false;
  const without: CadDocument = { ...document, parts: document.parts.filter(candidate => candidate.id !== part.id) };
  const after = partSolid(target, document).geometry,
    before = partSolid(target, without).geometry;
  if (!after || !before) return false;
  const was = meshVolume(before);
  return was > 0 && Math.abs(meshVolume(after) - was) <= was * 1e-6 + 1e-3;
}
