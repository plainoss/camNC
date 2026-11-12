import type { CadPart, CadPartCopy } from './types';

type NamedCopies = Pick<CadPart, 'name' | 'copies' | 'pattern'>;

/** The pattern slot a copy fills, counting from one after the part, or NaN for a copy the pattern didn't make. */
const patternSlot = (copy: CadPartCopy | undefined) => (copy?.pattern ? Number(copy.id.slice(copy.pattern.length + 1)) : NaN);

/**
 * How copies are numbered, counting the part itself as 1. A copy given a number keeps it. Copies without one, as every
 * copy saved before numbers were, count up from 2 in order, then each pattern slot takes the next number nobody holds.
 */
function copyNumbering(part: NamedCopies) {
  const copies = part.copies ?? [];
  const unnumbered = copies.filter(copy => !copy.pattern && copy.number === undefined);
  const held = new Set(copies.flatMap(copy => (copy.number === undefined ? [] : [copy.number])));
  const slots: number[] = [];
  let next = unnumbered.length + 2;
  /** Slot `k`'s number; excluded and absent slots keep theirs, so the ones after them don't move. */
  const slotNumber = (k: number) => {
    for (; slots.length < k; next++) if (!held.has(next)) slots.push(next);
    return slots[k - 1]!;
  };
  return { copies, unnumbered, held, slotNumber };
}

/** The number in a copy's name when it has none of its own, counting the part itself as 1. */
export function cadCopyNumber(part: NamedCopies, index: number): number {
  const copy = part.copies?.[index];
  if (copy?.number !== undefined) return copy.number;
  const { unnumbered, slotNumber } = copyNumbering(part);
  const slot = patternSlot(copy);
  if (Number.isInteger(slot) && slot > 0) return slotNumber(slot);
  const position = copy ? unnumbered.indexOf(copy) : -1;
  return position >= 0 ? position + 2 : index + 2;
}

/** What a copy is called: its own name, or the part's with its number. */
export const cadCopyName = (part: NamedCopies, index: number): string =>
  part.copies?.[index]?.name ?? `${part.name} ${cadCopyNumber(part, index)}`;

/** The number for a copy added by hand: one past every number in use, a pattern's excluded slots included. */
export function nextCadCopyNumber(part: NamedCopies): number {
  const { copies, unnumbered, held, slotNumber } = copyNumbering(part);
  const lastSlot = Math.max(
    (part.pattern?.count ?? 1) - 1,
    ...(part.pattern?.excluded ?? []),
    ...copies.map(patternSlot).filter(slot => Number.isInteger(slot) && slot > 0)
  );
  return Math.max(unnumbered.length + 1, ...held, lastSlot > 0 ? slotNumber(lastSlot) : 1) + 1;
}

/** A copy of a part, added by hand, with the next free number. */
export const numberedCadCopy = (part: NamedCopies, copy: CadPartCopy): CadPartCopy => ({ ...copy, number: nextCadCopyNumber(part) });
