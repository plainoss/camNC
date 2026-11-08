import { newCadId } from './document';
import { cadCopyName } from './partPatterns';
import type { CadDocument, CadPartCopy, CadPoint, EvaluatedCadPart } from './types';

/** Adds another of a part, laid out with the unplaced parts until it's placed. */
export function addPartCopy(
  document: CadDocument,
  partId: string,
  options: { mirrored?: boolean } = {}
): { document: CadDocument; id: string } {
  const copy: CadPartCopy = { id: newCadId(), ...(options.mirrored && { mirrored: true }) };
  return {
    id: copy.id,
    document: {
      ...document,
      revision: document.revision + 1,
      parts: document.parts.map(part => (part.id === partId ? { ...part, copies: [...(part.copies ?? []), copy] } : part)),
    },
  };
}

/** Removes one copy of a part, leaving the part and its other copies. */
export function removePartCopy(document: CadDocument, partId: string, copyId: string): CadDocument {
  return {
    ...document,
    revision: document.revision + 1,
    parts: document.parts.map(part => {
      if (part.id !== partId || !part.copies?.some(copy => copy.id === copyId)) return part;
      const { copies: _copies, ...rest } = part;
      const copies = part.copies.filter(copy => copy.id !== copyId);
      return copies.length ? { ...rest, copies } : rest;
    }),
  };
}

/** The ID CAM gives a part's mirror image, which it cuts as a part of its own. */
export const mirroredPartId = (partId: string) => `${partId}:mirrored`;

// Mirroring reverses each loop, so turning it back keeps outer loops and holes running the way they did.
const mirrorLoop = (points: CadPoint[]) => points.map(point => ({ ...point, x: -point.x })).reverse();

/** A part's mirror image across its sketch's y axis: the shape a mirrored copy is cut to. */
export function mirrorEvaluatedPart(part: EvaluatedCadPart): EvaluatedCadPart {
  return {
    ...part,
    partId: mirroredPartId(part.partId),
    outline: mirrorLoop(part.outline),
    holes: part.holes.map(mirrorLoop),
    loops: part.loops.map(loop => ({ ...loop, points: mirrorLoop(loop.points) })),
    ...(part.cuts && {
      cuts: part.cuts.map(cut => ({ ...cut, outline: mirrorLoop(cut.outline), islands: cut.islands.map(mirrorLoop) })),
    }),
  };
}

/** One shape to cut, and a name for each piece of it. */
export interface CadPartToCut {
  part: EvaluatedCadPart;
  names: string[];
}

/**
 * What gets cut: each part with its plain copies, and its mirror image for any mirrored copies. Pieces are named as the
 * assembly names them, the part's name and then a number for each further copy.
 */
export function cadPartsToCut(document: CadDocument, parts: readonly EvaluatedCadPart[]): CadPartToCut[] {
  return parts.flatMap(part => {
    const source = document.parts.find(candidate => candidate.id === part.partId);
    const copies = source?.copies ?? [];
    const named = (index: number) => (index ? cadCopyName(source ?? part, index - 1) : part.name);
    const same = [0, ...copies.flatMap((copy, i) => (copy.mirrored ? [] : [i + 1]))].map(named),
      mirrored = copies.flatMap((copy, i) => (copy.mirrored ? [named(i + 1)] : []));
    return [
      { part, names: same },
      ...(mirrored.length ? [{ part: { ...mirrorEvaluatedPart(part), name: `${part.name} (mirrored)` }, names: mirrored }] : []),
    ];
  });
}
