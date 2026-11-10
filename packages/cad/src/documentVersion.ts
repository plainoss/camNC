import type { CadDocument } from './types';

/** Saved source features determine the minimum reader version. */
export function cadDocumentVersion(document: CadDocument): CadDocument['version'] {
  return document.folders?.length ||
    document.parts.some(part => part?.features?.some(feature => feature?.copyId) || part?.pattern?.excluded?.length)
    ? 3
    : document.parts.some(part => part?.features?.length)
      ? 2
      : 1;
}
