import { isJoinedBody } from './extrudeSteps';
import { cadDrawnOnSupports, effectivePlacement } from './drawnOn';
import { cadCopyName } from './partPatterns';
import { joinedCopyPlacement } from './placement';
import type { CadDocument, CadPartCopy } from './types';

/** Read-only physical membership: direct Add bodies accompany every available copy of their host. */
export function physicalJoinedCopies(document: CadDocument, generation: CadDocument = document): CadDocument {
  const byId = new Map(document.parts.map(part => [part.id, part]));
  const generated = new Map(generation.parts.map(part=>[part.id,part]));
  const supports = cadDrawnOnSupports(generation);
  const parts = document.parts.map(part => {
    const parent = isJoinedBody(document, part) && byId.get(part.addTo!);
    if (!parent || !parent.copies?.length) return part;
    // Supported seed operations carry both members of this relation. Preserve its generation basis;
    // reconstructing it from rounded final seed rotations would move untouched inherited copies.
    const generatedParent=generated.get(parent.id),generatedPart=generated.get(part.id);
    const parentAt=generatedParent && effectivePlacement(generatedParent,supports),
      partAt=generatedPart && effectivePlacement(generatedPart,supports);
    const inherited: CadPartCopy[] = parent.copies.flatMap((copy, index) => {
      if (part.copies?.some(own => own.id === copy.id)) return [];
      const placement =
        parentAt && partAt && copy.placement
          ? joinedCopyPlacement(parentAt, partAt, copy.placement, !!copy.mirrored)
          : undefined;
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
