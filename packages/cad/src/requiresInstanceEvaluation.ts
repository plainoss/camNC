import type { CadDocument } from './types';

/** Placement regeneration affects ordered poses and all features that can give one instance different material. */
export function requiresInstanceEvaluation(document: CadDocument): boolean {
  return (
    document.operationOrder !== undefined ||
    !!document.partCuts?.length ||
    // A Mirror › Add follows its plane as laid out, so a move needs the part made again.
    document.parts.some(part => part.remove || part.mirrorJoins?.length || part.features?.some(feature => feature.copyId))
  );
}
