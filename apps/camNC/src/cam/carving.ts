import { unionPaths, type BoardCarving, type BoardRequest, type LibraryTool } from '@wbcnc/cam';
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
}

/** Rotate about the artwork's centre, then move it onto the board. */
export function placeItem(item: CarvingItemV1): Loop[] {
  const angle = (item.rotation * Math.PI) / 180;
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return item.outline.map(loop => loop.map(p => ({ x: item.x + p.x * c - p.y * s, y: item.y + p.x * s + p.y * c })));
}

export const carvingRegion = (items: CarvingItemV1[]): Loop[] => unionPaths(items.flatMap(placeItem));
export const itemName = (item: CarvingItemV1): string => (item.art.kind === 'text' ? `"${item.art.text}"` : item.art.fileName);
export const withItems = (carving: CarvingV1, items: CarvingItemV1[]): CarvingV1 => ({ ...carving, items, region: carvingRegion(items) });

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

/** The board request with the job's carving on it, when the board is the carving's. */
export function withCarving(request: BoardRequest, job: CamJobV1): BoardRequest {
  if (!job.carving?.region.length) return request;
  return { ...request, carvings: [boardCarving(job.carving, job.plan ?? kDefaultPlan)] };
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
  if (!carving.items.length) return 'Add text or an SVG to carve.';
  if (carving.items.some(item => item.art.kind === 'text' && !item.art.text.trim())) return 'Type something to carve.';
  if (!carving.region.length) return 'The artwork has no filled shapes to carve.';
  if (carving.maxDepth >= board.thickness) return `The depth must be less than the board's ${board.thickness} mm.`;
  return null;
}
