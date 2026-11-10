import {
  holdSettingsOf,
  isCut,
  kRetentionLabels,
  relayoutBoard,
  respaceBoard,
  type BoardNest,
  type BoardV1,
  type NestOptions,
  type PartInstance,
  type StockBoardV1,
} from '../boards';
import type { JobBoard } from '../useJobBoards';

const fmt = (v: number) => `${+v.toFixed(1)}`;

/** A board with the holding and spacing settings of `from`. */
export function withBoardSetup(board: BoardV1, from: BoardV1): BoardV1 {
  const { guidedTabs, taped, margin, gap, ...rest } = board;
  void guidedTabs;
  void taped;
  void margin;
  void gap;
  return { ...rest, ...holdSettingsOf(from) };
}

/** Whether any other uncut board differs from `selected` in its margin, gap, or holding settings. */
export function setupDiffers(selected: JobBoard, boards: JobBoard[]): boolean {
  const { board: sel, nest: selNest } = selected;
  return boards.some(({ board: b, nest }) => {
    if (b.id === sel.id || isCut(b)) return false;
    if (nest.margin !== selNest.margin || nest.gap !== selNest.gap) return true;
    if (b.retention !== sel.retention || !!b.taped !== !!sel.taped) return true;
    if (
      sel.retention === 'tabs' &&
      (b.tabs.width !== sel.tabs.width ||
        b.tabs.height !== sel.tabs.height ||
        b.tabs.minCount !== sel.tabs.minCount ||
        !!b.guidedTabs !== !!sel.guidedTabs)
    )
      return true;
    return false;
  });
}

/** Short summary of a board's spacing and hold settings: "1 mm margin, 4 mm gap, bottom skin". */
export function setupSummary(board: BoardV1, nest: Pick<BoardNest, 'margin' | 'gap'>): string {
  const hold = kRetentionLabels[board.retention].toLowerCase();
  return `${fmt(nest.margin)} mm margin, ${fmt(nest.gap)} mm gap, ${board.taped ? `${hold} and tape` : hold}`;
}

/** Applies `from`'s spacing and holding settings to every uncut board in-place, keeping each board's parts on it. */
export function applySetupToAll(
  boards: JobBoard[],
  from: BoardV1,
  instances: PartInstance[],
  bit: number,
  nestOptions?: NestOptions
): BoardV1[] {
  return boards.map(({ board }) => (isCut(board) ? board : respaceBoard(board, withBoardSetup(board, from), instances, bit, nestOptions)));
}

/**
 * Applies `from`'s spacing and holding settings to every uncut board, unpins their parts, and returns the stock list to
 * pack them onto (using fixed-size uncut boards as sheets for thicknesses that have no stock list entry).
 */
export function prepareGlobalRelayout(
  boards: JobBoard[],
  from: BoardV1,
  instances: PartInstance[],
  stock: StockBoardV1[],
  bit: number,
  nestOptions?: NestOptions
): { free: BoardV1[]; effectiveStock: StockBoardV1[] } {
  const free = boards.map(({ board }) => (isCut(board) ? board : relayoutBoard(withBoardSetup(board, from), instances, bit, nestOptions)));
  const byThickness = new Set(stock.map(s => +s.thickness.toFixed(1)));
  const effectiveStock: StockBoardV1[] = [...stock];
  for (const { board, nest } of boards) {
    const t = +board.thickness.toFixed(1);
    if (isCut(board) || byThickness.has(t) || board.size.fit) continue;
    if (effectiveStock.some(s => +s.thickness.toFixed(1) === t && s.w === nest.board.w && s.h === nest.board.h)) continue;
    effectiveStock.push({ id: `sheet-${board.id}`, thickness: t, w: nest.board.w, h: nest.board.h });
  }
  return { free, effectiveStock };
}
