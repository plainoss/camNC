import type { CadDocument } from './types';

/** Placement regeneration affects ordered poses and all features that can give one instance different material. */
export function requiresInstanceEvaluation(document: CadDocument): boolean {
  return (
    document.operationOrder !== undefined ||
    !!document.partCuts?.length ||
    document.parts.some(part => part.remove || part.features?.some(feature => feature.copyId))
  );
}
