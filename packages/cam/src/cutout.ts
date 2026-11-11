import { areaD, type PathD, type PathsD } from 'clipper2-ts';
import { profileFeatures } from './cutFeatures';
import type { PartFeatures } from './features';
import { offset, union } from './geom';

/**
 * A piece cut out of the board along a closed outline (board frame, mm): a carved sign cut to its silhouette. It is
 * planned as a part with nothing but its outline, so the board's tabs or skin hold it like any other part.
 */
export interface BoardCutout {
  id: string;
  name: string;
  outline: PathD;
  /** Tabs the user placed, board frame: used instead of picked ones, each moved onto the bit's path. */
  tabsAt?: { x: number; y: number }[];
}

/** How a carving's cutout follows it: the artwork's own outline, or a rounded plaque round it. */
export type CutoutShape = 'outline' | 'plaque';

/** Widest gap between pieces of artwork the outline bridges to keep them one piece, mm. */
const kMaxBridge = 40;

const outer = (paths: PathsD) => paths.filter(path => areaD(path) > 0);
const biggest = (paths: PathsD) => [...paths].sort((a, b) => areaD(b) - areaD(a));

/**
 * The silhouette a carving is cut out along, board frame: its outer outline grown by `margin` (holes filled), and
 * pieces closer than `kMaxBridge` joined by closing the gap between them, so a word comes out as one piece.
 * `plaque`: a rounded rectangle `margin` round the artwork. Empty when nothing is drawn.
 */
export function cutoutSilhouette(region: PathsD, shape: CutoutShape, margin: number, cornerRadius = 6): PathsD {
  if (!region.length) return [];
  if (shape === 'outline') {
    const grown = outer(offset(region, margin));
    for (let bridge = 0; bridge <= kMaxBridge; bridge += 4) {
      const closed = bridge ? outer(offset(offset(grown, bridge), -bridge)) : outer(union(grown, []));
      if (closed.length <= 1) return closed;
      if (bridge + 4 > kMaxBridge) return biggest(closed);
    }
  }
  const xs = region.flat().map(p => p.x),
    ys = region.flat().map(p => p.y);
  const box = { x0: Math.min(...xs) - margin, y0: Math.min(...ys) - margin, x1: Math.max(...xs) + margin, y1: Math.max(...ys) + margin };
  const r = Math.min(cornerRadius, (box.x1 - box.x0) / 2 - 0.1, (box.y1 - box.y0) / 2 - 0.1);
  const inner = [
    { x: box.x0 + r, y: box.y0 + r },
    { x: box.x1 - r, y: box.y0 + r },
    { x: box.x1 - r, y: box.y1 - r },
    { x: box.x0 + r, y: box.y1 - r },
  ];
  return r > 0 ? outer(offset([inner], r)) : [inner];
}

/** A cutout as CAM takes a part: its features, size and lower left corner on the board. */
export function cutoutPart(
  cutout: BoardCutout,
  thickness: number
): { features: PartFeatures; size: [number, number, number]; x: number; y: number; tabsAt?: { x: number; y: number }[] } {
  const { features, size, offset: at } = profileFeatures({ thickness, outline: cutout.outline, holes: [] });
  const tabsAt = cutout.tabsAt?.map(q => ({ x: q.x - at.x, y: q.y - at.y }));
  return { features, size, x: at.x, y: at.y, ...(tabsAt?.length && { tabsAt }) };
}
