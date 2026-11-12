import { cutoutSilhouette, unionPaths, type BoardCarving, type BoardRequest, type CutoutShape, type LibraryTool } from '@wbcnc/cam';
import type { BoardV1 } from './boards';
import type { CamJobV1 } from './jobDb';
import { kDefaultPlan, type PlanSettingsV1 } from './planSettings';

/** Fonts every browser has; the outlines are saved with the job, so a font another computer lacks changes nothing cut. */
export const kCarvingFonts = {
  sans: { label: 'Sans, bold', css: '700 {size}px Arial, Helvetica, sans-serif' },
  serif: { label: 'Serif, bold', css: '700 {size}px Georgia, "Times New Roman", serif' },
  slab: { label: 'Slab', css: '700 {size}px Rockwell, "Courier New", monospace' },
} as const;
export type CarvingFont = keyof typeof kCarvingFonts;

export interface WebFont {
  family: string;
  weight: number;
}

export const isWebFont = (font: CarvingFont | WebFont): font is WebFont => typeof font === 'object';

export const fontLabel = (font: CarvingFont | WebFont): string =>
  isWebFont(font) ? `${font.family}${font.weight === 400 ? '' : `, ${font.weight}`}` : kCarvingFonts[font].label;

export type CarvingArt = { kind: 'text'; text: string; font: CarvingFont | WebFont } | { kind: 'svg'; svg: string; fileName: string };

type Loop = { x: number; y: number }[];

export interface CarvingItemV1 {
  id: string;
  art: CarvingArt;
  /** Height of the artwork's ink, mm, before rotation; its width follows. */
  height: number;
  /** Centre on the board, mm from the lower left corner, Y up. */
  x: number;
  y: number;
  /** Degrees counter-clockwise, in [0, 360). */
  rotation: number;
  /** Centred on (0, 0), unrotated; drawn again only when art or height changes. */
  outline: Loop[];
  /** Original generated artwork survives local preparation, save/reopen and later size/detail changes. */
  generated?: {
    assetId: string;
    sourceSvg: string;
    prompt: string;
    summary: string;
    sourceRaster?: { dataUri: string; width: number; height: number };
    warnings?: string[];
    detail: 'simple' | 'balanced' | 'detailed';
    /** Accepted ink size at preparation; `height` matches the item's height then. */
    width: number;
    height: number;
    /** Maximum size the whole source was fitted into, reused when it is rechecked. */
    envelope?: { width: number; height: number };
    /** Settings and artwork used by the last accepted suitability check. */
    checkedFor: string;
  };
}

/** A carving job: one board, artwork V-carved into its top. */
export interface CarvingV1 {
  items: CarvingItemV1[];
  /** Deepest cut below the top, mm. */
  maxDepth: number;
  /** The V-bit (`shape: 'v'`). */
  vBit: LibraryTool;
  /** Clear flat bottoms with the job's flat bit first; otherwise the V-bit clears them. */
  clearWithFlat: boolean;
  /** Union of every item's placed outline, mm, Y up: what Plan cuts. */
  region: Loop[];
  /** Cut the carving out of the board along its silhouette, with the job's flat bit, after carving. */
  cutout?: CarvingCutoutV1;
}

export interface CarvingCutoutV1 {
  shape: CutoutShape;
  /** Wood left round the artwork, mm. */
  margin: number;
  /** What holds the piece once it's cut round: tabs, or a thin skin left on the bottom (on tape: cut at the end). */
  hold: 'tabs' | 'skin';
  /** Tabs placed on the drawing, board mm; none: Plan picks them. */
  tabsAt?: { x: number; y: number }[];
}

/** A new cutout: round the artwork, held by a skin on a taped board (no tab nubs on the sign's edge), else by tabs. */
export const newCutout = (taped: boolean): CarvingCutoutV1 => ({ shape: 'outline', margin: 6, hold: taped ? 'skin' : 'tabs' });

/** The outlines the carving is cut out along, board frame: one per piece; empty without a cutout. */
export const cutoutOutline = (carving: Pick<CarvingV1, 'region' | 'cutout'>): Loop[] =>
  carving.cutout ? cutoutSilhouette(carving.region, carving.cutout.shape, carving.cutout.margin) : [];

/** Rotate about the artwork's centre, then move it onto the board. */
export function placeItem(item: CarvingItemV1): Loop[] {
  const angle = (item.rotation * Math.PI) / 180;
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return item.outline.map(loop => loop.map(p => ({ x: item.x + p.x * c - p.y * s, y: item.y + p.x * s + p.y * c })));
}

export const carvingRegion = (items: CarvingItemV1[]): Loop[] => unionPaths(items.flatMap(placeItem));
/** Why an empty carving can't be planned; the Carve step's empty board shows the ways to start instead. */
export const kEmptyCarving = 'Add text or an SVG to carve.';
export const itemName = (item: CarvingItemV1): string => (item.art.kind === 'text' ? `"${item.art.text}"` : item.art.fileName);
/** The carving with these items. Tabs placed on the cut line move, turn and scale with the artwork they are next to. */
export const withItems = (carving: CarvingV1, items: CarvingItemV1[]): CarvingV1 => {
  const tabsAt = carving.cutout?.tabsAt && followArtwork(carving.cutout.tabsAt, carving.items, items);
  return {
    ...carving,
    items,
    region: carvingRegion(items),
    ...(carving.cutout && tabsAt && tabsAt !== carving.cutout.tabsAt && { cutout: { ...carving.cutout, tabsAt } }),
  };
};

/**
 * Board points next to the artwork, carried along when it is moved, turned or sized: each with the item it is closest to,
 * in that item's own frame. Left where they were, each is snapped to the nearest point of the moved cut line, so the
 * tabs would all bunch at the end closest to their old places.
 */
function followArtwork(points: { x: number; y: number }[], before: CarvingItemV1[], after: CarvingItemV1[]) {
  const moved = new Map(
    after.flatMap(next => {
      const was = before.find(item => item.id === next.id);
      const same = !was || (was.x === next.x && was.y === next.y && was.rotation === next.rotation && was.height === next.height);
      return same || !was.outline.length ? [] : [[was.id, { was, next }] as const];
    })
  );
  if (!moved.size) return points;
  const placed = before.filter(item => item.outline.length).map(item => ({ id: item.id, loops: placeItem(item) }));
  return points.map(q => {
    let owner: { id: string; d: number } | null = null;
    for (const { id, loops } of placed)
      for (const loop of loops) {
        const d = closestOnLoop(q, loop).d;
        if (!owner || d < owner.d) owner = { id, d };
      }
    const move = owner && moved.get(owner.id);
    if (!move) return q;
    const { was, next } = move;
    const turn = ((next.rotation - was.rotation) * Math.PI) / 180,
      scale = was.height ? next.height / was.height : 1;
    const c = Math.cos(turn) * scale,
      s = Math.sin(turn) * scale,
      dx = q.x - was.x,
      dy = q.y - was.y;
    return { x: next.x + dx * c - dy * s, y: next.y + dx * s + dy * c };
  });
}

/** V-bits offered for carving: the largest that fits the collet is ⌀8. Cutting data is cautious, for hardwood. */
export const kVBits: LibraryTool[] = [
  { number: 16, diameter: 4, shape: 'v', angle: 60, name: '60° V-bit ⌀4', feed: 800, plungeFeed: 200, rpm: 18000 },
  { number: 14, diameter: 6, shape: 'v', angle: 60, name: '60° V-bit ⌀6', feed: 1000, plungeFeed: 250, rpm: 18000 },
  { number: 13, diameter: 8, shape: 'v', angle: 60, name: '60° V-bit ⌀8', feed: 1000, plungeFeed: 250, rpm: 18000 },
  { number: 15, diameter: 4, shape: 'v', angle: 90, name: '90° V-bit ⌀4', feed: 1000, plungeFeed: 250, rpm: 18000 },
  { number: 11, diameter: 6, shape: 'v', angle: 90, name: '90° V-bit ⌀6', feed: 1200, plungeFeed: 300, rpm: 18000 },
  { number: 12, diameter: 8, shape: 'v', angle: 90, name: '90° V-bit ⌀8', feed: 1200, plungeFeed: 300, rpm: 18000 },
];
export const kDefaultVBit = kVBits.find(bit => bit.number === 14)!;

export const kCarvingBoard = { w: 300, h: 140, thickness: 18 };

export const isCarvingJob = (job: Pick<CamJobV1, 'carving'> | null | undefined): boolean => !!job?.carving;

/** A board planned with something to cut: parts, or a carving. */
export const hasWork = (request: Pick<BoardRequest, 'parts' | 'carvings'>) => request.parts.length > 0 || !!request.carvings?.length;

/** The carving as the CAM engine takes it, for the job's (only) board. */
export function boardCarving(carving: CarvingV1, plan: Pick<PlanSettingsV1, 'bit'>): BoardCarving {
  return {
    id: 'carving',
    name: carving.items.length === 1 ? itemName(carving.items[0]) : `${carving.items.length} items`,
    region: carving.region,
    tool: carving.vBit,
    maxDepth: carving.maxDepth,
    ...(carving.clearWithFlat && { clearTool: plan.bit }),
  };
}

/** The closest point of a closed loop to `q`, and how far it is. */
export function closestOnLoop(q: { x: number; y: number }, loop: Loop): { x: number; y: number; d: number } {
  let best = { x: loop[0].x, y: loop[0].y, d: Infinity };
  loop.forEach((a, i) => {
    const b = loop[(i + 1) % loop.length];
    const dx = b.x - a.x,
      dy = b.y - a.y,
      l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2)) : 0;
    const p = { x: a.x + t * dx, y: a.y + t * dy };
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < best.d) best = { ...p, d };
  });
  return best;
}
const distanceToLoop = (q: { x: number; y: number }, loop: Loop) => closestOnLoop(q, loop).d;

/** The board request with the job's carving on it, when the board is the carving's. */
export function withCarving(request: BoardRequest, job: CamJobV1): BoardRequest {
  if (!job.carving?.region.length) return request;
  const carved = { ...request, carvings: [boardCarving(job.carving, job.plan ?? kDefaultPlan)] };
  const cutout = job.carving.cutout;
  const outline = cutoutOutline(job.carving);
  if (!cutout || !outline.length) return carved;
  // Placed tabs go to the piece they are on.
  const nearest = (q: { x: number; y: number }) =>
    outline.reduce((best, loop, i) => (distanceToLoop(q, loop) < distanceToLoop(q, outline[best]) ? i : best), 0);
  return {
    ...carved,
    holdDown: cutout.hold === 'tabs' ? 'tabs' : request.taped ? 'fixture-tape' : 'skin',
    cutouts: outline.map((loop, i) => {
      const tabsAt = cutout.hold === 'tabs' ? cutout.tabsAt?.filter(q => nearest(q) === i) : undefined;
      return {
        id: `cutout-${i}`,
        name: outline.length > 1 ? `Cutout ${i + 1}` : 'Cutout',
        outline: loop,
        ...(tabsAt?.length && { tabsAt }),
      };
    }),
  };
}

/** The one board of a carving job, at a fixed size: nothing is nested on it. */
export function carvingBoard(size: { w: number; h: number; thickness: number }): BoardV1 {
  return {
    id: 'carving-board',
    name: 'A',
    thickness: size.thickness,
    material: 'oak',
    size: { fit: false, w: size.w, h: size.h },
    retention: 'none',
    taped: true,
    tabs: { width: 5, height: 2, minCount: 3 },
    margin: 0,
    items: [],
  };
}

/** Problems that stop the carving from being planned, for people. */
export function carvingProblem(carving: CarvingV1, board: Pick<BoardV1, 'thickness'>): string | null {
  if (!carving.items.length) return kEmptyCarving;
  if (carving.items.some(item => item.art.kind === 'text' && !item.art.text.trim())) return 'Type something to carve.';
  if (!carving.region.length) return 'The artwork has no filled shapes to carve.';
  if (carving.maxDepth >= board.thickness) return `The depth must be less than the board's ${board.thickness} mm.`;
  return null;
}
