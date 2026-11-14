import { copyFaceOperationProblem, overlappedParts, partIsBuiltOn, type CadDocument } from '@wbcnc/cad';

/**
 * The part a New extrude's picked regions run into, for Add to merge with: the one earlier part extruded along the same
 * normal whose material it shares some volume with. Null when it runs into none, or into several, where Merge with all
 * or a merge scope is chosen by hand, or when it isn't a plain New extrude.
 */
export function autoAddTarget(document: CadDocument, partId: string): string | null {
  const part = document.parts.find(p => p.id === partId);
  if (!part || part.addTo !== undefined || part.mergeAll || part.remove || part.thin || part.faceProfile || !part.regions?.length)
    return null;
  const touched = overlappedParts(document, partId);
  const into = touched.length === 1 ? document.parts.find(p => p.id === touched[0]) : undefined;
  // A part other steps build on, or one that can't join that part, stays a part of its own.
  return into && !partIsBuiltOn(document, part, into) && !copyFaceOperationProblem(part) ? into.id : null;
}
