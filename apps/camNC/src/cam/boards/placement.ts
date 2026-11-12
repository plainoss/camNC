import { holdBox, pathClearance } from '@wbcnc/cam/holdPoints';
import { placedSize, type Rect } from '@wbcnc/cam/nest';
import { partDist, type SettlePart } from '@wbcnc/cam/settle';
import type { BoardNest, PartInstance, PartPosition } from '../boards';
import { EPS } from './fitBoard';

/** At least `gap` apart. */
export const apart = (a: Rect, b: Rect, gap: number) =>
  a.x + a.w + gap <= b.x + EPS || b.x + b.w + gap <= a.x + EPS || a.y + a.h + gap <= b.y + EPS || b.y + b.h + gap <= a.y + EPS;
/** Inside the board's edge margin (a fitted board grows: only its lower and left edge). */
export const insideMargin = (r: Rect, margin: number, board?: { w: number; h: number }) =>
  r.x >= margin - EPS && r.y >= margin - EPS && (!board || (r.x + r.w <= board.w - margin + EPS && r.y + r.h <= board.h - margin + EPS));

/** A part at this spot keeps clear of the board's fixtures: its real outline, with room for the cut. */
export function clearOfHolds(nest: Pick<BoardNest, 'holds' | 'bit'>, inst: PartInstance, at: PartPosition) {
  const r = placedRect(at, inst);
  const turn = (loops: [number, number][][]) =>
    at.rotated ? loops.map(l => l.map(([x, y]): [number, number] => [inst.size[1] - y, x])) : loops;
  const rect: [number, number][] = [
    [0, 0],
    [inst.size[0], 0],
    [inst.size[0], inst.size[1]],
    [0, inst.size[1]],
  ];
  const part: SettlePart = {
    id: inst.id,
    w: r.w,
    h: r.h,
    outer: turn(inst.outline?.outer ?? [rect]),
    holes: turn(inst.outline?.holes ?? []),
  };
  return nest.holds.every(h => {
    const box = h.kind === 'screw' ? { x: h.x, y: h.y, w: 0, h: 0, r: h.d / 2 } : { ...holdBox(h), r: 0 };
    return partDist(box, part, at) >= pathClearance(h, nest.bit / 2) + nest.bit / 2 - 1e-6;
  });
}

/** Bounding rectangle of a placed body (for hit testing / labels). */
export function placedRect(p: { x: number; y: number; rotated: boolean }, inst: PartInstance): Rect {
  const s = placedSize({ id: inst.id, w: inst.size[0], h: inst.size[1] }, p.rotated);
  return { x: p.x, y: p.y, w: s.w, h: s.h };
}

/**
 * The nest as it is drawn and cut: only the parts that are on the board. After a design edit, a part whose stored spot
 * no longer works (off the board, or on a part that grew) keeps that spot in `placements`, so undoing the edit brings it
 * back there, but it is `unplaced`: it is drawn off the board, once, not also at its old spot over the other parts.
 */
export function onBoardOnly<N extends Pick<BoardNest, 'placements' | 'unplaced'>>(nest: N): N {
  const off = new Set(nest.unplaced);
  if (!nest.placements.some(p => off.has(p.id))) return nest;
  return { ...nest, placements: nest.placements.filter(p => !off.has(p.id)) };
}
