import type { CadPoint, EvaluatedCadPart } from './types';
import type { Vec3 } from './placement';

type Bounds = [Vec3, Vec3];
const inside = (loop: CadPoint[], x: number, y: number) => {
  let result = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i]!,
      b = loop[j]!;
    if (a.y > y !== b.y > y && x < a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y)) result = !result;
  }
  return result;
};

/** Whether an edge enters the open reach. Edges lying on its boundary do not split any occupied cell. */
function enters(a: CadPoint, b: CadPoint, lo: Vec3, hi: Vec3) {
  let from = 0,
    to = 1;
  for (const axis of ['x', 'y'] as const) {
    const i = axis === 'x' ? 0 : 1,
      delta = b[axis] - a[axis];
    if (!delta) {
      if (a[axis] <= lo[i] || a[axis] >= hi[i]) return false;
    } else {
      const p = (lo[i] - a[axis]) / delta,
        q = (hi[i] - a[axis]) / delta;
      from = Math.max(from, Math.min(p, q));
      to = Math.min(to, Math.max(p, q));
    }
  }
  return from < to;
}

/**
 * Exact occupied boxes for a rectilinear tool within a finite reach, including overlapping pockets and islands.
 * Eligibility is proved from every boundary crossing the reach before sampling cells. A diagonal or curved boundary
 * is refused, never classified as a full bounding cell. Rigid moves do not use this decomposition.
 */
export function occupiedToolBoxes(tool: EvaluatedCadPart, lo: Vec3, hi: Vec3): { boxes: Bounds[] } | { refused: string } {
  const cuts = (tool.cuts ?? []).flatMap(cut => {
    const bottom = cut.side === 'top' ? tool.thickness - cut.to : cut.from;
    const top = cut.side === 'top' ? tool.thickness - cut.from : cut.to;
    return bottom < hi[2] && top > lo[2] ? [{ cut, bottom, top }] : [];
  });
  const loops = [tool.outline, ...tool.holes, ...cuts.flatMap(({ cut }) => [cut.outline, ...cut.islands])];
  for (const loop of loops)
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!,
        b = loop[(i + 1) % loop.length]!;
      if (a.x !== b.x && a.y !== b.y && enters(a, b, lo, hi))
        return { refused: 'has a nonrectilinear occupied-material boundary in this cut' };
    }
  const stops = (values: number[], from: number, to: number) =>
    [...new Set([from, to, ...values.filter(value => value > from && value < to)])].sort((a, b) => a - b);
  const xs = stops(
    loops.flatMap(loop => loop.map(p => p.x)),
    lo[0],
    hi[0]
  );
  const ys = stops(
    loops.flatMap(loop => loop.map(p => p.y)),
    lo[1],
    hi[1]
  );
  const zs = stops(
    cuts.flatMap(cut => [cut.bottom, cut.top]),
    lo[2],
    hi[2]
  );
  if ((xs.length - 1) * (ys.length - 1) * (zs.length - 1) > 20000) return { refused: 'has too many occupied-material cells for this cut' };
  const boxes: Bounds[] = [];
  for (let z = 0; z + 1 < zs.length; z++)
    for (let y = 0; y + 1 < ys.length; y++) {
      let run: number | undefined;
      for (let x = 0; x + 1 < xs.length; x++) {
        const px = (xs[x]! + xs[x + 1]!) / 2,
          py = (ys[y]! + ys[y + 1]!) / 2,
          pz = (zs[z]! + zs[z + 1]!) / 2;
        const occupied =
          inside(tool.outline, px, py) &&
          !tool.holes.some(loop => inside(loop, px, py)) &&
          !cuts.some(
            ({ cut, bottom, top }) =>
              pz > bottom && pz < top && inside(cut.outline, px, py) && !cut.islands.some(loop => inside(loop, px, py))
          );
        if (occupied && run === undefined) run = xs[x];
        if (run !== undefined && (!occupied || x + 2 === xs.length)) {
          const end = occupied ? xs[x + 1]! : xs[x]!;
          boxes.push([
            [run, ys[y]!, zs[z]!],
            [end, ys[y + 1]!, zs[z + 1]!],
          ]);
          run = undefined;
        }
      }
    }
  return { boxes };
}
