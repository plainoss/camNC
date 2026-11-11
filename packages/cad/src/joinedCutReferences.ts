import { isJoinedBody } from './extrudeSteps';
import { cadPartReference, cadPartReferenceOwner } from './partReferences';
import type { CadDocument } from './types';

/** A derived material selection keeps its original owner so expanding a host cannot enable self-cuts. */
export function joinedCutReferences(document: CadDocument, references: readonly string[]) {
  const raw = new Set(references);
  const derived = new Set<string>();
  const original = references.map(reference => ({
    reference,
    origin: cadPartReferenceOwner(document, reference)?.id ?? reference.split(':')[0]!,
  }));
  return [
    ...original,
    ...original.flatMap(({ reference, origin }) => {
      const parent = cadPartReferenceOwner(document, reference);
      const copyId = parent && reference !== parent.id ? reference.slice(parent.id.length + 1) : undefined;
      if (!parent || (copyId !== undefined && !parent.copies?.some(copy => copy.id === copyId))) return [];
      return document.parts.flatMap(part => {
        if (part.addTo !== parent.id || !isJoinedBody(document, part)) return [];
        if (copyId !== undefined && !part.copies?.some(copy => copy.id === copyId)) return [];
        const child = cadPartReference(part.id, copyId);
        // Explicit selections retain their own owner and the existing duplicate-reference behavior.
        if (raw.has(child) || derived.has(child)) return [];
        derived.add(child);
        return [{ reference: child, origin }];
      });
    }),
  ];
}
