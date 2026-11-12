import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';
import type { ReactNode } from 'react';
import { boardLabel, boardSizeLabel, isCut, type BoardNest, type BoardV1 } from '../boards';
import { CutBadge } from './CutBadge';

const fmt = (v: number) => `${+v.toFixed(1)}`;

/**
 * A board's label on the table, above its drawing: its name, thickness and size, and what needs attention. It stops at
 * `maxWidth` (short of the next board's label), but only the thickness and size are cut short: the name and the
 * warnings always show whole, reaching a little further into the gap when they must (an empty board has no width of
 * its own).
 */
export function BoardLabel({
  board,
  sized,
  nest,
  unheld,
  nutHits,
  fetching,
  left,
  bottom,
  maxWidth,
  children,
}: {
  board: BoardV1;
  /** The board at a size being dragged to: its size label. */
  sized: BoardV1;
  nest: BoardNest;
  unheld: number;
  nutHits: boolean;
  fetching: boolean;
  left: number;
  bottom: string;
  maxWidth: number;
  /** Shown last: how a drop would go. */
  children?: ReactNode;
}) {
  return (
    <div
      data-board-label
      className="pointer-events-none absolute flex items-center gap-x-2 text-xs whitespace-nowrap *:shrink-0"
      style={{ left, bottom, maxWidth }}>
      <span className="font-medium">{boardLabel(board)}</span>
      {isCut(board) && <CutBadge board={board} />}
      <span className="!shrink min-w-0 truncate text-muted-foreground">
        {fmt(board.thickness)} mm · <span className="font-mono text-[11px]">{boardSizeLabel(sized, nest)}</span>
      </span>
      {nest.unplaced.length > 0 && <span className="font-medium text-amber-600 dark:text-amber-400">{nest.unplaced.length} off it</span>}
      {unheld > 0 && <span className="font-medium text-destructive">{unheld} can’t hold</span>}
      {nutHits && <span className="font-medium text-destructive">collet nut hits</span>}
      {fetching && <LoadingSpinner className="size-3" />}
      {children}
    </div>
  );
}
