import { simplifyLoop, unionPaths } from '@wbcnc/cam';
import { isWebFont, kCarvingFonts, type CarvingArt } from './carving';
import { ensureWebFont, webFontCss } from './webFonts';

type Loop = { x: number; y: number }[];

/** Pixels per mm the artwork is drawn at before it's outlined: 0.1 mm. */
const kPxPerMm = 10;
/** No artwork is drawn bigger than this many pixels; a long text gets a coarser grid. */
const kMaxPixels = 6_000_000;
/** How far a simplified outline may stray from the pixel staircase, in pixels. */
const kSimplifyPx = 0.6;

/** Ink of a drawn image: dark, opaque pixels. */
function inkMask(data: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3] / 255;
    const dark = 1 - (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 765;
    ink[i] = a * dark > 0.5 ? 1 : 0;
  }
  return ink;
}

/**
 * Outlines of a pixel mask in mm, Y up, centred on (0, 0): each row's runs of ink become rectangles, rows with the same
 * runs one taller rectangle, and their union is simplified back to smooth lines.
 */
export function maskOutline(
  ink: Uint8Array,
  w: number,
  h: number,
  pxPerMm: number,
  maxRuns = Infinity,
  simplifyPixels = kSimplifyPx
): Loop[] {
  const rects: Loop[] = [];
  let runCount = 0;
  const runsOf = (y: number) => {
    const runs: number[] = [];
    for (let x = 0; x < w; ) {
      if (!ink[y * w + x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < w && ink[y * w + x]) x++;
      runs.push(start, x);
      // Generated noisy masks can contain hundreds of thousands of runs; reject before polygon union allocates them.
      if (++runCount > maxRuns) throw new Error('Artwork has too many pixel runs. Use simpler filled shapes.');
    }
    return runs;
  };
  const toMm = (px: number, py: number) => ({ x: (px - w / 2) / pxPerMm, y: (h / 2 - py) / pxPerMm });
  let open: { runs: number[]; from: number } | null = null;
  const close = (to: number) => {
    if (!open) return;
    for (let i = 0; i < open.runs.length; i += 2)
      rects.push([toMm(open.runs[i], to), toMm(open.runs[i + 1], to), toMm(open.runs[i + 1], open.from), toMm(open.runs[i], open.from)]);
    open = null;
  };
  for (let y = 0; y < h; y++) {
    const runs = runsOf(y);
    if (open && runs.length === open.runs.length && runs.every((v, i) => v === open!.runs[i])) continue;
    close(y);
    if (runs.length) open = { runs, from: y };
  }
  close(h);
  if (!rects.length) return [];
  const tol = simplifyPixels / pxPerMm;
  return unionPaths(rects)
    .map(loop => simplifyLoop(loop, tol))
    .filter(loop => loop.length >= 3);
}

function canvas(w: number, h: number) {
  const c =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('This browser cannot draw the artwork');
  return ctx;
}

const kUnreadableSvg = 'This SVG could not be read. Use filled shapes, without linked images or fonts.';

/** Absolute SVG lengths in CSS pixels; relative or missing dimensions do not define a viewport. */
function svgLengthPx(length: string | null): number | undefined {
  const match = length?.trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(px|mm|cm|in|pt|pc|q)?$/i);
  if (!match) return undefined;
  const pxPerUnit: Record<string, number> = { px: 1, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, pt: 96 / 72, pc: 16, q: 96 / 101.6 };
  const px = Number(match[1]) * pxPerUnit[match[2]?.toLowerCase() ?? 'px'];
  return Number.isFinite(px) && px > 0 ? px : undefined;
}

async function svgImage(svg: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error(kUnreadableSvg);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The artwork's outlines, mm, Y up, centred on (0, 0), with its ink `height` mm tall. Text is drawn in the browser's
 * font, an SVG as an image; both are outlined from 0.1 mm pixels (coarser for very long text).
 */
export async function outlineArt(
  art: CarvingArt,
  height: number,
  limits: { pixelsPerMm?: number; maxPixels?: number; maxMaskRuns?: number; simplifyPixels?: number } = {}
): Promise<{ region: Loop[]; width: number; height: number }> {
  const pixelsPerMm = Math.min(kPxPerMm, limits.pixelsPerMm ?? kPxPerMm);
  const maxPixels = Math.min(kMaxPixels, limits.maxPixels ?? kMaxPixels);
  if (art.kind === 'text') {
    const font = art.font;
    if (isWebFont(font)) await ensureWebFont(font);
    const css = isWebFont(font) ? `${font.weight} {size}px ${webFontCss(font)}` : kCarvingFonts[font].css;
    const probe = canvas(8, 8);
    probe.font = css.replace('{size}', '100');
    const m = probe.measureText(art.text);
    const inkH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    if (!art.text.trim() || inkH <= 0) return { region: [], width: 0, height: 0 };
    const width = ((m.actualBoundingBoxLeft + m.actualBoundingBoxRight) / inkH) * height;
    const ppm = Math.min(pixelsPerMm, Math.sqrt(maxPixels / ((width + 2) * (height + 2))));
    const pad = 4;
    const w = Math.ceil(width * ppm) + 2 * pad,
      h = Math.ceil(height * ppm) + 2 * pad;
    const ctx = canvas(w, h);
    const size = (100 * height * ppm) / inkH;
    ctx.font = css.replace('{size}', size.toFixed(2));
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'alphabetic';
    const scale = size / 100;
    ctx.fillText(art.text, pad + m.actualBoundingBoxLeft * scale, pad + m.actualBoundingBoxAscent * scale);
    const region = maskOutline(inkMask(ctx.getImageData(0, 0, w, h).data, w, h), w, h, ppm, limits.maxMaskRuns, limits.simplifyPixels);
    return { region, width, height };
  }
  const doc = new DOMParser().parseFromString(art.svg, 'image/svg+xml');
  if (doc.querySelector('parsererror')) throw new Error(kUnreadableSvg);
  const svg = doc.documentElement;
  if (svg.localName !== 'svg' || (svg.namespaceURI && svg.namespaceURI !== 'http://www.w3.org/2000/svg'))
    throw new Error('This file is not an SVG. Choose an SVG file.');
  const viewBox = svg
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const validViewBox = viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0;
  const viewportWidth = svgLengthPx(svg.getAttribute('width'));
  const viewportHeight = svgLengthPx(svg.getAttribute('height'));
  const hasViewport = viewportWidth !== undefined && viewportHeight !== undefined;
  const sourceWidth = hasViewport ? viewportWidth : validViewBox ? viewBox[2] : undefined;
  const sourceHeight = hasViewport ? viewportHeight : validViewBox ? viewBox[3] : undefined;
  if (sourceWidth === undefined || sourceHeight === undefined) throw new Error(kUnreadableSvg);
  if (!validViewBox) svg.setAttribute('viewBox', `0 0 ${sourceWidth} ${sourceHeight}`);
  const aspect = sourceWidth / sourceHeight;
  const width = height * aspect;
  const ppm = Math.min(pixelsPerMm, Math.sqrt(maxPixels / ((width + 2) * (height + 2))));
  const w = Math.max(1, Math.round(width * ppm)),
    h = Math.max(1, Math.round(height * ppm));
  // Give the image an explicit pixel viewport: intrinsic sizes may be missing or use physical/percentage units.
  svg.setAttribute('width', `${w}px`);
  svg.setAttribute('height', `${h}px`);
  if (!svg.namespaceURI) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const img = await svgImage(new XMLSerializer().serializeToString(svg));
  const ctx = canvas(w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return {
    region: maskOutline(inkMask(ctx.getImageData(0, 0, w, h).data, w, h), w, h, ppm, limits.maxMaskRuns, limits.simplifyPixels),
    width,
    height,
  };
}

/** The outlines moved to the artwork's place on the board. */
export const placeRegion = (region: Loop[], x: number, y: number): Loop[] =>
  region.map(loop => loop.map(p => ({ x: p.x + x, y: p.y + y })));
