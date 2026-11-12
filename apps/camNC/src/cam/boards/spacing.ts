import type { BoardV1, Retention } from '../boards';

/** Narrowest strip of stock, mm, that holds a tab after the cuts on both sides of it (the hold check's). */
export const kTabWeb = 3.5;

/**
 * Default border inside the board edge: the outline cut (bit) plus 2 mm stays on the board. With tabs, enough that the
 * strip left outside the cut holds them.
 */
export const defaultMargin = (bit: number, retention?: Retention) => +(bit + (retention === 'tabs' ? kTabWeb : 2)).toFixed(1);

/**
 * Gap between parts: the bit plus 4 mm, so outline cuts never meet. With tabs, room for both cuts and a strip between
 * them that holds the tabs of either part.
 */
export const boardGap = (bit: number, retention?: Retention) => Math.ceil(retention === 'tabs' ? 2 * bit + kTabWeb : bit + 4);

/**
 * Before the bit changes: keep each board's margin and gap as they are, so the nest the user saw stays (a bigger
 * bit would otherwise widen them and push parts off the board).
 */
export function freezeSpacing(boards: BoardV1[], bit: number): BoardV1[] {
  return boards.map(b => ({ ...b, margin: b.margin ?? defaultMargin(bit, b.retention), gap: b.gap ?? boardGap(bit, b.retention) }));
}

/**
 * What gives tabs room on a board where some can't hold their part. A gap or margin narrower than tabs need with this
 * bit (both outline cuts and a strip between them that holds the tabs) is the cause however the parts are moved, so
 * that's said with the spacing that fits; otherwise more room around the part. A smaller bit needs less either way.
 */
export function tabRoomFix(nest: { gap: number; margin: number }, bit: number, parts: number): string {
  const gap = boardGap(bit, 'tabs'),
    margin = defaultMargin(bit, 'tabs');
  const wider = [
    ...(nest.gap < gap ? [`the gap between parts to ${gap} mm`] : []),
    ...(nest.margin < margin ? [`the margin to ${margin} mm`] : []),
  ];
  if (wider.length) return `The spacing is too tight for tabs with the ⌀${bit} bit: widen ${wider.join(' and ')}, use a smaller bit`;
  return `Give ${parts === 1 ? 'it' : 'them'} more room (a wider gap or margin, or move ${parts === 1 ? 'it' : 'them'}), use a smaller bit`;
}

/**
 * Why a board's gap is too tight for this bit: the cut around each part needs the bit's width (+1 mm), or one part's
 * outline cut eats into its neighbour. Blocks the job.
 */
export function spacingProblem(board: Pick<BoardV1, 'name'>, nest: { gap: number; margin: number }, bit: number): string | null {
  if (nest.gap < bit + 1) return `Board ${board.name}: the ${nest.gap} mm gap between parts is too narrow for the ⌀${bit} bit.`;
  return null;
}

/**
 * The outline cuts run past the board's edge (the margin is narrower than the bit): the bit only cuts air there, fine
 * unless something holds the board down there. A note, not a blocker (on tab boards the hold check catches parts the
 * thin strip left at the edge can't hold).
 */
export function edgeNote(
  board: Pick<BoardV1, 'name' | 'fixtures' | 'items'>,
  nest: { gap: number; margin: number },
  bit: number
): string | null {
  // No parts, no outline cuts (a carving's board).
  if (nest.margin >= bit || !board.items.length) return null;
  const past = `Board ${board.name}: the outline cuts run past the board edge (${nest.margin} mm margin, ⌀${bit} bit).`;
  // The hold check blocks the job if the bit would hit a fixture.
  return board.fixtures?.length
    ? `${past} Keep screws and clamps clear of it: the job is blocked if the bit would hit one.`
    : `${past} Fine if nothing is clamped or screwed there.`;
}
