import type { CadDocument } from './types';

/** Saved source features determine the minimum reader version. */
export function cadDocumentVersion(document: CadDocument): CadDocument['version'] {
  // An older reader would cut where a Boolean joins.
  if (document.partCuts?.some(step => step?.operation !== undefined)) return 7;
  if (document.constructions?.length) return 6;
  // Older readers must refuse an explicit Off just as they refuse a Dogbone override.
  if (document.partCuts?.some(step => step?.cornerRelief !== undefined)) return 5;
  return document.operationOrder !== undefined || document.copyTransforms !== undefined || document.legacyPartCutIds !== undefined
    ? 4
    : document.folders?.length ||
        document.parts.some(part => part?.features?.some(feature => feature?.copyId) || part?.pattern?.excluded?.length)
      ? 3
      : document.parts.some(part => part?.features?.length)
        ? 2
        : 1;
}
