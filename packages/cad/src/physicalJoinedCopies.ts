import { isJoinedBody } from './extrudeSteps';
<<<<<<< HEAD
=======
import { cadDrawnOnSupports, effectivePlacement } from './drawnOn';
>>>>>>> 346bcfcf51c8d7439e0581f9b3840ddc5d4af851
import { cadCopyName } from './partPatterns';
import { joinedCopyPlacement } from './placement';
import type { CadDocument, CadPartCopy } from './types';

/** Read-only physical membership: direct Add bodies accompany every available copy of their host. */
export function physicalJoinedCopies(document: CadDocument): CadDocument {
  const byId = new Map(document.parts.map(part => [part.id, part]));
<<<<<<< HEAD
  const parts = document.parts.map(part => {
    const parent = isJoinedBody(document, part) && byId.get(part.addTo!);
    if (!parent || !parent.copies?.length) return part;
    const inherited: CadPartCopy[] = parent.copies.flatMap((copy, index) => {
      if (part.copies?.some(own => own.id === copy.id)) return [];
      const placement =
        parent.placement && part.placement && copy.placement
          ? joinedCopyPlacement(parent.placement, part.placement, copy.placement, !!copy.mirrored)
          : undefined;
=======
  const supports = cadDrawnOnSupports(document);
  const parts = document.parts.map(part => {
    const parent = isJoinedBody(document, part) && byId.get(part.addTo!);
    if (!parent || !parent.copies?.length) return part;
    const parentAt = effectivePlacement(parent, supports),
      partAt = effectivePlacement(part, supports);
    const inherited: CadPartCopy[] = parent.copies.flatMap((copy, index) => {
      if (part.copies?.some(own => own.id === copy.id)) return [];
      const placement =
        parentAt && partAt && copy.placement ? joinedCopyPlacement(parentAt, partAt, copy.placement, !!copy.mirrored) : undefined;
>>>>>>> 346bcfcf51c8d7439e0581f9b3840ddc5d4af851
      return [
        {
          id: copy.id,
          name: `${part.name} · ${cadCopyName(parent, index)}`,
          ...(copy.mirrored && { mirrored: true }),
          ...(placement && { placement }),
        },
      ];
    });
    return inherited.length ? { ...part, copies: [...(part.copies ?? []), ...inherited] } : part;
  });
  return parts.some((part, index) => part !== document.parts[index]) ? { ...document, parts } : document;
}
