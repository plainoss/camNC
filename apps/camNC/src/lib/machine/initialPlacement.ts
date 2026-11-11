interface P2 {
  x: number;
  y: number;
}

interface Rect {
  min: P2;
  max: P2;
}

/** The board outline on the machine view: its size and angle about its XY zero (lower left corner). */
interface BoardOutline {
  w: number;
  h: number;
  rotationDeg: number;
}

/** What lies on the bed when the program's zero is placed at the origin: the toolpath and the board, if known. */
export function placedExtent(toolpathBounds: Rect, board?: BoardOutline | null): Rect | null {
  const points: P2[] = [toolpathBounds.min, toolpathBounds.max];
  if (board) {
    const a = (board.rotationDeg * Math.PI) / 180;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    for (const [x, y] of [
      [0, 0],
      [board.w, 0],
      [0, board.h],
      [board.w, board.h],
    ])
      points.push({ x: x * c - y * s, y: x * s + y * c });
  }
  // A program without moves has empty (infinite) bounds: only the board then.
  const finite = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!finite.length) return null;
  return {
    min: { x: Math.min(...finite.map(p => p.x)), y: Math.min(...finite.map(p => p.y)) },
    max: { x: Math.max(...finite.map(p => p.x)), y: Math.max(...finite.map(p => p.y)) },
  };
}

/**
 * Where a newly loaded program first goes on the bed: at the controller's work zero, moved just far enough that the
 * program and its board lie on the bed when they fit there. An axis on which they're longer than the bed stays at the
 * zero, so the out-of-bounds warning still tells about a real overhang.
 */
export function initialToolpathOffset(zero: P2, extent: Rect | null, bed: Rect | null): P2 {
  if (!extent || !bed) return { x: zero.x, y: zero.y };
  const fit = (axis: 'x' | 'y') => {
    const lo = bed.min[axis] - extent.min[axis];
    const hi = bed.max[axis] - extent.max[axis];
    if (lo > hi) return zero[axis];
    return Math.min(Math.max(zero[axis], lo), hi);
  };
  return { x: fit('x'), y: fit('y') };
}
