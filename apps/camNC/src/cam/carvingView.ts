import { placeItem, type CarvingItemV1 } from './carving';
type Loop = { x: number; y: number }[];

/** The carving's outlines as an SVG path, board mm with Y up drawn Y down. */
export const carvingPath = (region: Loop[], h: number) =>
  region.map(loop => `M${loop.map(p => `${p.x.toFixed(2)},${(h - p.y).toFixed(2)}`).join('L')}Z`).join('');

export function carvingBounds(region: Loop[]) {
  const pts = region.flat();
  if (!pts.length) return null;
  const xs = pts.map(p => p.x),
    ys = pts.map(p => p.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/**
 * Where a new item goes: the board's centre, or the nearest place straight above or below it, in 5 mm steps, where it
 * stays on the board and clear of the items already there. The centre when there's no such place.
 */
export function freeSpot(items: CarvingItemV1[], outline: Loop[], size: { w: number; h: number }) {
  const x = size.w / 2;
  const own = carvingBounds(outline);
  if (!own) return { x, y: size.h / 2 };
  const taken = items.map(item => carvingBounds(placeItem(item))).filter(box => !!box);
  const gap = 2;
  const fits = (y: number) => {
    const box = { x0: x + own.x0, x1: x + own.x1, y0: y + own.y0, y1: y + own.y1 };
    if (box.y0 < 0 || box.y1 > size.h) return false;
    return taken.every(t => box.x1 + gap <= t.x0 || t.x1 + gap <= box.x0 || box.y1 + gap <= t.y0 || t.y1 + gap <= box.y0);
  };
  for (let d = 0; d <= size.h / 2; d += 5) for (const y of [size.h / 2 - d, size.h / 2 + d]) if (fits(y)) return { x, y };
  return { x, y: size.h / 2 };
}

export const centred = (item: CarvingItemV1, size: { w: number; h: number }) => {
  const box = carvingBounds(placeItem(item));
  if (!box) return { x: size.w / 2, y: size.h / 2 };
  return { x: item.x + size.w / 2 - (box.x0 + box.x1) / 2, y: item.y + size.h / 2 - (box.y0 + box.y1) / 2 };
};
