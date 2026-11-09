import { cadCopyName } from './partPatterns';
import type { CadDocument } from './types';

/** A whole source family, or one physical tool copy. Copy IDs may themselves contain colons. */
export const cadPartReference = (partId: string, copyId?: string) => (copyId === undefined ? partId : `${partId}:${copyId}`);

/** The source dependency of a family or copy reference, including a copy that has disappeared. */
export function cadPartReferenceOwner(document: Pick<CadDocument, 'parts'>, reference: string) {
  return document.parts.find(part => part.id === reference) ?? document.parts.find(part => reference.startsWith(`${part.id}:`)) ?? null;
}

/** Resolve the persisted reference by identity, never by a body's position or its displayed order. */
export function cadPartReferenceName(document: Pick<CadDocument, 'parts'>, reference: string): string | null {
  const source = cadPartReferenceOwner(document, reference);
  if (!source) return null;
  if (source.id === reference) return source.name;
  const index = source.copies?.findIndex(copy => cadPartReference(source.id, copy.id) === reference) ?? -1;
  return index >= 0 ? cadCopyName(source, index) : null;
}

/** Picking a family highlights its copies too; picking one copy never highlights its siblings. */
export function cadPartReferenceMatches(references: readonly string[], partId: string, copyId?: string): boolean {
  return references.includes(partId) || (copyId !== undefined && references.includes(cadPartReference(partId, copyId)));
}
