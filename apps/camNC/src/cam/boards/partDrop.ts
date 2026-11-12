import { isCut, nestBoard, type BoardNest, type BoardV1, type NestOptions, type PartInstance, type PartPosition } from '../boards';
import { apart, clearOfHolds, insideMargin, placedRect } from './placement';

/** Where a dragged body would land on a board, and the board after dropping it there. */
export interface PartDrop {
  /** Lower left corner where it lands; null: it fits nowhere on this board. */
  at: PartPosition | null;
  /** Lands exactly at the drop point (stored as its position), or where the board's nest puts it. */
  exact: boolean;
  /** The board with the body on it (unchanged when it doesn't fit). */
  board: BoardV1;
}

/**
 * The boards to save for an undo or redo: what is cut stays as it is now. A program can finish after the snapshot was taken,
 * and restoring that snapshot would forget the cut and offer the same program again.
 */
export function restoreBoards(snapshot: BoardV1[], current: BoardV1[]): BoardV1[] {
  const now = new Map(current.map(b => [b.id, b]));
  const restored = snapshot.map(b => {
    const latest = now.get(b.id);
    return latest && isCut(latest) ? latest : b;
  });
  const kept = new Set(snapshot.map(b => b.id));
  return [...restored, ...current.filter(b => isCut(b) && !kept.has(b.id))];
}

/** The board with this body no longer set aside: it's nested like the rest again. */
export function notAside(board: BoardV1, item: string): BoardV1 {
  const out = { ...board };
  const rest = Object.entries(board.setAside ?? {}).filter(([id]) => id !== item);
  if (rest.length) out.setAside = Object.fromEntries(rest);
  else delete out.setAside;
  return out;
}

/** The board with this body off it, on the table at `at`. */
export function setAsidePart(board: BoardV1, item: string, at: PartPosition): BoardV1 {
  const out: BoardV1 = { ...board, setAside: { ...board.setAside, [item]: at } };
  if (board.layout) out.layout = { ...board.layout, at: Object.fromEntries(Object.entries(board.layout.at).filter(([id]) => id !== item)) };
  return out;
}

/**
 * Drop a body (from this board or another one of the same thickness) with its lower left corner at `at`. Close to where
 * the nest would put it among the others (within `snap` mm), it goes there. Otherwise, when that spot is free (inside the
 * margin, `gap` away from the other parts, clear of the fixtures) it stays exactly there. Else it goes where the nest
 * puts it, or nowhere when it doesn't fit. Pinned either way; the other parts stay where they are.
 */
export function dropPart(
  board: BoardV1,
  instances: PartInstance[],
  bit: number,
  item: string,
  at: PartPosition,
  snap = 0,
  opts: NestOptions = {}
): PartDrop {
  const inst = instances.find(i => i.id === item);
  if (!inst) return { at: null, exact: false, board };
  if (board.setAside?.[item]) board = notAside(board, item);
  const same = board.items.includes(item);
  const now = nestBoard(board, instances, bit, opts);
  const others = now.placements.filter(p => p.id !== item);
  const rest = Object.fromEntries(others.map(p => [p.id, { x: p.x, y: p.y, rotated: p.rotated }]));
  const pinned = (board.pinned ?? []).filter(id => id !== item);
  const nested: BoardV1 = {
    ...board,
    items: same ? board.items : [...board.items, item],
    pinned: same && !board.pinned?.includes(item) ? pinned : [...pinned, item],
    ...(others.length && { layout: { w: now.board.w, h: now.board.h, at: rest } }),
  };
  if (!others.length) delete nested.layout;
  const placedAt = nestBoard(nested, instances, bit, { ...opts, holds: false });
  const nestAt = placedAt.placements.find(p => p.id === item);
  const snapped = (): PartDrop =>
    nestAt
      ? {
          at: { x: nestAt.x, y: nestAt.y, rotated: nestAt.rotated },
          exact: false,
          board: {
            ...nested,
            layout: {
              w: placedAt.board.w,
              h: placedAt.board.h,
              at: { ...rest, [item]: { x: nestAt.x, y: nestAt.y, rotated: nestAt.rotated } },
            },
          },
        }
      : { at: null, exact: false, board };
  if (nestAt && Math.hypot(nestAt.x - at.x, nestAt.y - at.y) <= snap && nestAt.rotated === at.rotated) return snapped();
  const r = placedRect(at, inst);
  const free =
    insideMargin(r, now.margin, now.board) &&
    others.every(p => apart(r, placedRect(p, instances.find(i => i.id === p.id)!), now.gap)) &&
    clearOfHolds(now, inst, at);
  if (free)
    return {
      at,
      exact: true,
      board: { ...nested, pinned: [...pinned, item], layout: { w: now.board.w, h: now.board.h, at: { ...rest, [item]: at } } },
    };
  return snapped();
}

/**
 * A body dragged to `at` on the board as nested: is that spot free (inside the margin, `gap` from the other parts, clear
 * of the fixtures)? A quick check while dragging; `dropPart` decides on the drop.
 */
export function spotFree(nest: BoardNest, instances: PartInstance[], item: string, at: PartPosition): boolean {
  const inst = instances.find(i => i.id === item);
  if (!inst) return false;
  const r = placedRect(at, inst);
  const others = nest.placements.filter(p => p.id !== item).map(p => placedRect(p, instances.find(i => i.id === p.id)!));
  return insideMargin(r, nest.margin, nest.board) && others.every(o => apart(r, o, nest.gap)) && clearOfHolds(nest, inst, at);
}
