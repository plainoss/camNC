import { cadPartReferenceOwner } from './partReferences';
import type { CadDocument, CadPart } from './types';

/** A source reference cuts the whole family; a copy reference cuts only its stable physical slot. */
export function resolvePartCutTargets(document: Pick<CadDocument, 'parts'>, references: readonly string[]) {
  const families = new Set(references.filter(reference => document.parts.some(part => part.id === reference)));
  const targets: { part: CadPart; copyId?: string }[] = [];
  const missing: string[] = [];
  for (const reference of new Set(references)) {
    const part = cadPartReferenceOwner(document, reference);
    const copyId = part && reference !== part.id ? reference.slice(part.id.length + 1) : undefined;
    if (!part || (copyId !== undefined && !part.copies?.some(copy => copy.id === copyId))) {
      missing.push(reference);
      continue;
    }
    // The family already contains this physical instance. Never append its cut twice.
    if (copyId !== undefined && families.has(part.id)) continue;
    targets.push({ part, ...(copyId !== undefined && { copyId }) });
  }
  return { targets, missing };
}
