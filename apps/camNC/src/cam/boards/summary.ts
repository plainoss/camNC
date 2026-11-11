import type { BoardNest } from '../boards';

/**
 * "2 boards, 81 % yield": boards with parts on them, and part area over their board area. Empty boards (a tab each, not
 * cut) are counted on their own, "…, 1 empty", so the count adds up to the tabs.
 */
export function layoutSummary(boards: { nest: Pick<BoardNest, 'board' | 'yield' | 'placements'> }[]) {
  const used = boards.filter(b => b.nest.placements.length);
  if (!used.length) return 'No part placed yet.';
  const area = used.reduce((a, b) => a + b.nest.board.w * b.nest.board.h, 0);
  const parts = used.reduce((a, b) => a + b.nest.yield * b.nest.board.w * b.nest.board.h, 0);
  const empty = boards.length - used.length;
  return `${used.length} ${used.length === 1 ? 'board' : 'boards'}, ${Math.round((100 * parts) / Math.max(area, 1e-9))} % yield${empty ? `, ${empty} empty` : ''}`;
}
