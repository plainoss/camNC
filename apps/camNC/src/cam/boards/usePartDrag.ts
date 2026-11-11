import { useEffect, useRef, useState } from 'react';
import { dropPart, placedRect, type NestOptions, type PartDrop, type PartInstance, type PartPosition } from '../boards';
import type { JobBoard } from '../useJobBoards';

export const sameThickness = (a: number, b: number) => +a.toFixed(1) === +b.toFixed(1);
/** Drop points in 0.1 mm. */
export const round = (v: number) => Math.round(v * 10) / 10;
/** Pointer travel (px) before a press on a part becomes a drag. */
export const kDragStart = 4;
/** Empty table around what's on it, mm: room to lay parts down, and what a part dropped is kept within. */
export const kTableMargin = 600;
/** Within this many px of the nest's spot, a dropped part snaps to it. */
const kSnapPx = 14;

export type DrawingTarget =
  | { kind: 'drawing'; board: string; at: PartPosition; drop: PartDrop | null }
  /** A board in the list: it has no spot to point at, so the part goes into its nest. */
  | { kind: 'rail'; board: string; drop: PartDrop | null }
  /** On the table, off every board: its upper left corner there. */
  | { kind: 'table'; at: PartPosition }
  | { kind: 'new' };

export interface ShapeDrag {
  item: string;
  from: string;
  rotated: boolean;
  /** Pointer minus the part's lower left corner, mm. */
  grab: { x: number; y: number };
  start: { x: number; y: number };
  pointer: { x: number; y: number };
  moved: boolean;
  target: DrawingTarget | null;
}

/** Client point -> board frame (mm, Y up) of a drawing. */
export function toBoard(frame: SVGGraphicsElement, x: number, y: number) {
  const m = frame.getScreenCTM();
  return m ? new DOMPoint(x, y).matrixTransform(m.inverse()) : null;
}

/** What a part drag reads when the pointer moves: the latest of these, not the ones the drag started with. */
export interface PartDragInputs {
  boards: JobBoard[];
  instances: PartInstance[];
  bit: number;
  pxPerMm: number;
  onDrop: (item: string, board: string, drop: PartDrop | null, fromRail?: boolean) => void;
  onNewBoard: (item: string) => void;
  onSelect: (id: string) => void;
  onSetAside: (item: string, at: PartPosition) => void;
  nestOptions: NestOptions;
  fromView: (vx: number, vy: number) => { x: number; y: number };
}

/**
 * Dragging a part's outline over the table: where it would land under the pointer (a board's drawing, a board in the list,
 * "New board" or the table), and the drop when the pointer comes up. `update` starts a drag.
 */
export function usePartDrag(
  inputs: PartDragInputs,
  {
    scroller,
    fitted,
    panned,
  }: {
    scroller: { current: HTMLDivElement | null };
    fitted: { current: 'all' | 'board' | null };
    panned: { current: boolean };
  }
) {
  const [drag, setDrag] = useState<ShapeDrag | null>(null);
  const latest = useRef(inputs);
  latest.current = inputs;
  const dragRef = useRef<ShapeDrag | null>(null);
  const update = (d: ShapeDrag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  const targetAt = (d: ShapeDrag, x: number, y: number): DrawingTarget | null => {
    const { boards, instances, bit, pxPerMm, nestOptions, fromView } = latest.current;
    const el = document.elementFromPoint(x, y);
    const inst = instances.find(i => i.id === d.item)!;
    const r = placedRect({ x: 0, y: 0, rotated: d.rotated }, inst);
    const onTable = (): DrawingTarget | null => {
      const box = scroller.current?.getBoundingClientRect();
      if (!box || !el || !scroller.current!.contains(el)) return null;
      const p = fromView(x - box.left, y - box.top);
      const keep = (v: number) => Math.max(-kTableMargin, round(v));
      return { kind: 'table', at: { x: keep(p.x - d.grab.x), y: keep(p.y - (r.h - d.grab.y)), rotated: d.rotated } };
    };
    if (el?.closest('[data-new-board-drop]')) return { kind: 'new' };
    const inRail = el?.closest<HTMLElement>('[data-rail-drop]')?.dataset.railDrop;
    if (inRail) {
      const prev = d.target;
      if (prev?.kind === 'rail' && prev.board === inRail) return prev;
      const onRail = boards.find(b => b.board.id === inRail)?.board;
      const part = instances.find(i => i.id === d.item)!;
      if (!onRail || inRail === d.from) return null;
      // No spot it could take: its nest decides.
      const nowhere = { x: -1e6, y: -1e6, rotated: d.rotated };
      return {
        kind: 'rail',
        board: inRail,
        drop: sameThickness(part.thickness, onRail.thickness) ? dropPart(onRail, instances, bit, d.item, nowhere, 0, nestOptions) : null,
      };
    }
    const card = el?.closest<HTMLElement>('[data-board-drop]');
    const id = card?.dataset.boardDrop;
    const board = boards.find(b => b.board.id === id)?.board;
    if (!card || !board) return onTable();
    const frame = card.querySelector<SVGGraphicsElement>('[data-board-frame]');
    const p = frame && toBoard(frame, x, y);
    if (!p) return null;
    const at = { x: round(p.x - d.grab.x), y: round(p.y - d.grab.y), rotated: d.rotated };
    // The pointer and the part's middle both beyond the board's edge: laid down beside it, not on it. A fitted board with nothing
    // on it is only its margins: anywhere near it counts.
    const { nest } = boards.find(b => b.board.id === id)!;
    const size = nest.board;
    const within = (q: { x: number; y: number }) => q.x >= 0 && q.y >= 0 && q.x <= size.w && q.y <= size.h;
    const onlyMargins = board.size.fit && !nest.placements.length;
    if (!onlyMargins && !within(p) && !within({ x: at.x + r.w / 2, y: at.y + r.h / 2 })) return onTable();
    const prev = d.target;
    if (prev?.kind === 'drawing' && prev.board === board.id && prev.at.x === at.x && prev.at.y === at.y && prev.at.rotated === at.rotated)
      return prev;
    const drop = sameThickness(inst.thickness, board.thickness)
      ? dropPart(board, instances, bit, d.item, at, kSnapPx / pxPerMm, nestOptions)
      : null;
    return { kind: 'drawing', board: board.id, at, drop };
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const moved = d.moved || Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y) > kDragStart;
      // Near the column's top or bottom edge: scroll, so every board can be reached. Not when it's so short that it's
      // all edge: it would run away from the board under the pointer.
      const box = moved && scroller.current?.getBoundingClientRect();
      if (box && box.height > 200 && e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom) {
        const by = (at: number, lo: number, hi: number) => (at < lo + 48 ? -24 : at > hi - 48 ? 24 : 0);
        const [dx, dy] = [by(e.clientX, box.left, box.right), by(e.clientY, box.top, box.bottom)];
        if (dx || dy) {
          fitted.current = null;
          scroller.current!.scrollBy(dx, dy);
        }
      }
      const next = { ...d, moved, pointer: { x: e.clientX, y: e.clientY } };
      update(moved ? { ...next, target: targetAt(next, e.clientX, e.clientY) } : next);
    };
    const finish = (e: PointerEvent | null) => {
      const d = dragRef.current;
      update(null);
      if (!d?.moved || !e) return;
      // The click that ends a drag doesn't open the board under the pointer.
      panned.current = true;
      setTimeout(() => (panned.current = false), 50);
      const target = targetAt(d, e.clientX, e.clientY);
      const on = latest.current;
      if (target?.kind === 'new') on.onNewBoard(d.item);
      else if (target?.kind === 'drawing') on.onDrop(d.item, target.board, target.drop?.at ? target.drop : null);
      else if (target?.kind === 'rail') on.onDrop(d.item, target.board, target.drop?.at ? target.drop : null, true);
      else if (target?.kind === 'table') on.onSetAside(d.item, target.at);
    };
    const up = (e: PointerEvent) => finish(e);
    const cancel = () => finish(null);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
      const d = dragRef.current;
      if (e.key.toLowerCase() !== 'r' || !d?.moved) return;
      // Turned about the pointer's spot on it.
      const inst = latest.current.instances.find(i => i.id === d.item)!;
      const was = placedRect({ x: 0, y: 0, rotated: d.rotated }, inst);
      const turned = { ...d, rotated: !d.rotated, grab: { x: (d.grab.x * was.h) / was.w, y: (d.grab.y * was.w) / was.h } };
      update({ ...turned, target: targetAt(turned, d.pointer.x, d.pointer.y) });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
    };
    // Listeners for the whole drag; they read the latest state from refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!drag]);

  return { drag, update };
}
