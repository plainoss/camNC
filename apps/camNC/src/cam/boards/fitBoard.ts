import { nestRects, placedSize, type NestResult, type Rect } from '@wbcnc/cam/nest';
import { fitsMachine } from '@wbcnc/cam/settle';

const kMaxElongation = 2.5;

/**
 * Fit a board to its parts, but not as a strip: the smallest area can be one long row (2.4 m for the kinderregal
 * sides and shelves). Beyond 2.5:1, nest on a width near the square root of the parts' area instead.
 */
export function fitCompact(items: { id: string; w: number; h: number }[], gap: number, margin: number, fixed: Rect[]): NestResult {
  // Bodies placed by hand are obstacles, and the board grows to take them in.
  const grow = (b: { w: number; h: number }) => ({
    w: Math.max(b.w, ...fixed.map(r => r.x + r.w + margin)),
    h: Math.max(b.h, ...fixed.map(r => r.y + r.h + margin)),
  });
  const first = nestRects(items, { gap, margin, keepOuts: fixed });
  const fit = { ...first, board: grow(first.board) };
  const { w, h } = fit.board;
  if (!items.length || Math.max(w, h) / Math.min(w, h) <= kMaxElongation) return fit;
  const area = items.reduce((a, i) => a + (i.w + gap) * (i.h + gap), 0);
  const width = Math.max(...items.map(i => i.w)) + 2 * margin;
  for (const W of [Math.sqrt(area) * 1.2, Math.sqrt(area) * 1.5, Math.sqrt(area) * 2].map(x =>
    Math.max(width, Math.ceil(x + 2 * margin))
  )) {
    const n = nestRects(items, { gap, margin, keepOuts: fixed, board: { w: W, h: 1e6 } });
    if (n.unplaced.length) continue;
    const used = n.placements.map(p => {
      const i = items.find(x => x.id === p.id)!;
      return { x: p.x + (p.rotated ? i.h : i.w), y: p.y + (p.rotated ? i.w : i.h) };
    });
    const board = grow({ w: Math.max(...used.map(u => u.x)) + margin, h: Math.max(...used.map(u => u.y)) + margin });
    const partArea = items.reduce((a, i) => a + i.w * i.h, 0);
    if (Math.max(board.w, board.h) / Math.min(board.w, board.h) <= kMaxElongation)
      return { ...n, board, yield: partArea / (board.w * board.h) };
  }
  return fit;
}

/** The items turned 90°: nested so, each is placed the other way round. */
export const turnedItems = (items: { id: string; w: number; h: number }[]) => items.map(i => ({ id: i.id, w: i.h, h: i.w }));
export const turnedBack = (n: NestResult): NestResult => ({ ...n, placements: n.placements.map(p => ({ ...p, rotated: !p.rotated })) });

/**
 * On a board of this size: parts keep their grain direction where they fit, the ones that don't may turn 90° into the
 * room left.
 */
export function nestOnSize(
  items: { id: string; w: number; h: number }[],
  size: { w: number; h: number },
  gap: number,
  margin: number,
  keepOuts: Rect[]
) {
  const n = nestRects(items, { gap, margin, keepOuts, board: size });
  if (!n.unplaced.length) return n;
  const placed = n.placements.map(p => {
    const i = items.find(x => x.id === p.id)!;
    return { x: p.x, y: p.y, ...placedSize(i, p.rotated) };
  });
  const rest = items.filter(i => n.unplaced.includes(i.id)).map(i => ({ ...i, canRotate: true }));
  const turned = nestRects(rest, { gap, margin, keepOuts: [...keepOuts, ...placed], board: size });
  if (!turned.placements.length) return n;
  const order = new Map(items.map((it, i) => [it.id, i]));
  return {
    ...n,
    placements: [...n.placements, ...turned.placements].sort((a, b) => order.get(a.id)! - order.get(b.id)!),
    unplaced: turned.unplaced,
  };
}

/** The extent of the placed parts, plus the margin: what a fitted board is cut to. */
export function usedSize(n: NestResult, items: { id: string; w: number; h: number }[], margin: number, fixed: Rect[]) {
  const rects = [
    ...n.placements.map(p => {
      const i = items.find(x => x.id === p.id)!;
      return { x: p.x, y: p.y, ...placedSize(i, p.rotated) };
    }),
    ...fixed,
  ];
  return {
    w: Math.max(2 * margin, ...rects.map(r => r.x + r.w + margin)),
    h: Math.max(2 * margin, ...rects.map(r => r.y + r.h + margin)),
  };
}

/** Up to whole mm, but never rounded past the machine it fits on. */
export function wholeMm(b: { w: number; h: number }, machine?: { w: number; h: number }) {
  const up = { w: ceilMm(b.w), h: ceilMm(b.h) };
  if (!machine || fitsMachine(machine, up.w, up.h) || !fitsMachine(machine, b.w, b.h)) return up;
  const [mw, mh] = fitsAsIs(machine, b) ? [machine.w, machine.h] : [machine.h, machine.w];
  return { w: Math.min(up.w, Math.max(b.w, Math.floor(mw))), h: Math.min(up.h, Math.max(b.h, Math.floor(mh))) };
}

/** The machine's long axis is X. */
export const wideMachine = (m: { w: number; h: number }) => m.w >= m.h;
export const fitsAsIs = (m: { w: number; h: number }, b: { w: number; h: number }) => b.w <= m.w + EPS && b.h <= m.h + EPS;

/**
 * Fit a board to its parts on this machine: as `fitCompact`, lying with its long side along the machine's long axis (the
 * whole layout turned when that's the way it fits). Too big either way: nested on the work area, the board cut to what's
 * on it, and the parts left over `unplaced`. Bodies placed by hand (`fixed`) stay, so the layout isn't turned then.
 */
export function fitOnMachine(
  items: { id: string; w: number; h: number }[],
  gap: number,
  margin: number,
  fixed: Rect[],
  machine: { w: number; h: number }
): NestResult {
  const area = (n: NestResult) =>
    n.placements.reduce((a, p) => a + items.find(i => i.id === p.id)!.w * items.find(i => i.id === p.id)!.h, 0);
  const straight = fitCompact(items, gap, margin, fixed);
  const turned = fixed.length || !items.length ? undefined : turnedBack(fitCompact(turnedItems(items), gap, margin, fixed));
  const lying = (n: NestResult) => n.board.w >= n.board.h === wideMachine(machine) || n.board.w === n.board.h;
  const fits = [straight, ...(turned ? [turned] : [])].filter(n => fitsAsIs(machine, n.board));
  if (fits.length) return fits.find(lying) ?? fits[0];
  // Too big for the machine: as much as fits on the work area, then cut down to it.
  const on = (its: typeof items) => nestOnSize(its, machine, gap, margin, fixed);
  const options = [on(items), ...(fixed.length ? [] : [turnedBack(on(turnedItems(items)))])];
  const best = options.reduce((a, b) => (area(b) > area(a) ? b : a));
  const board = usedSize(best, items, margin, fixed);
  const total = items.reduce((a, i) => a + i.w * i.h, 0);
  return { ...best, board, yield: total && area(best) / (board.w * board.h) };
}

export const EPS = 1e-6;
/** Up to whole mm, ignoring float noise (571.0000001 stays 571). */
export const ceilMm = (v: number) => Math.ceil(v - 1e-6);
