import {
  CAD_CHORD_TOLERANCE,
  cadPartReferenceOwner,
  evaluateCadPart,
  sketchRegions,
  splitHalves,
  type CadDocument,
  type CadDrawnOn,
} from '@wbcnc/cad';
import { detachStudioCopy } from './detachStudioCopy';
import { prepareStudioPreview } from './useStudioPreview';

export interface SplitPlane {
  across: CadDrawnOn['on'];
  datum?: string;
}

/**
 * The design with `target` (a part, or one copy of a part as `<partId>:<copyId>`) split in two by `plane`: the part
 * keeps one side and the other is a part of its own. A copy is taken out of its pattern first, as a part of its own.
 * `existing`: the part whose Split is being changed.
 */
export function splitPartWith(
  document: CadDocument,
  target: string,
  plane: SplitPlane,
  id: string
): { document: CadDocument; partId: string } | { error: string } {
  const owner = cadPartReferenceOwner(document, target);
  if (!owner) return { error: 'That part is gone. Pick another.' };
  let next = document,
    partId = owner.id,
    fromCopy = !!owner.split?.fromCopy;
  if (owner.id !== target) {
    const detached = detachStudioCopy(document, owner.id, target.slice(owner.id.length + 1));
    if ('error' in detached) return detached;
    next = detached.document;
    partId = detached.partId;
    fromCopy = true;
    // A copy of a part made from its whole sketch is its whole sketch too, whatever its regions are now called.
    const copied = next.parts.find(part => part.id === partId);
    const whole = owner.regions && owner.regions.length === sketchRegions(owner.sketch, CAD_CHORD_TOLERANCE).length;
    if (copied && whole && evaluateCadPart(copied).diagnostics.some(problem => problem.code === 'region-missing')) {
      const regions = sketchRegions(copied.sketch, CAD_CHORD_TOLERANCE).map(region => region.id);
      next = { ...next, parts: next.parts.map(part => (part.id === partId ? { ...part, regions } : part)) };
    }
  } else if (!owner.split && (owner.copies?.length || owner.pattern))
    return { error: `Split one of ${owner.name}’s copies, or a part without copies.` };
  next = {
    ...next,
    revision: next.revision + 1,
    parts: next.parts.map(part =>
      part.id !== partId
        ? part
        : {
            ...part,
            split: { id, across: plane.across, ...(plane.datum && { datum: plane.datum }), ...(fromCopy && { fromCopy: true as const }) },
          }
    ),
  };
  // Laid out twice: the first works out where the plane crosses the part, the second splits it there.
  next = prepareStudioPreview(prepareStudioPreview(next));
  const split = next.parts.find(part => part.id === partId);
  if (!split?.split?.line)
    return { error: 'Pick a plane that stands across the part, as the Front or Right plane does across a board on Top.' };
  if (!splitHalves(split)) return { error: 'The plane doesn’t cut through the part.' };
  return { document: next, partId };
}
