import { carvingBoard, kDefaultVBit, type CarvingV1 } from '../../carving';
import { outlineArt } from '../../carvingOutline';
import { kDefaultPlan } from '../../planSettings';
import { carvingDetailMm, prepareCarvingArt, type CarvingDetail, type Loop } from '../prepare';
import { sanitizeCarvingSvg } from '../sanitize';
import { difference, offset, polyArea } from '../../../../../../packages/cam/src/geom';

/** The defaults a new carving job gets (jobDb.ts): 60° V ⌀6, 3 mm deep, flat clearing with the plan's bit. */
export const kLiveCarving: CarvingV1 = { items: [], region: [], vBit: kDefaultVBit, maxDepth: 3, clearWithFlat: true };
export const kLiveBoard = carvingBoard({ w: 200, h: 200, thickness: 18 });

export interface Finding {
  kind: 'removed-black' | 'narrow-white' | 'fragile-white';
  /** Centre in the SVG's own viewBox coordinates. */
  at: [number, number];
  measuredWidth: number;
  neededWidth: number;
  /** Size of the affected piece in viewBox units. */
  extent: number;
  units: 'viewBox';
}
export interface Evaluation {
  sanitizeError?: string;
  ok: boolean;
  accepted: boolean;
  errors: string[];
  warnings: string[];
  substantiveWarnings: number;
  removedCutAreaFraction?: number;
  removedCutAreaMm2?: number;
  narrowLandAreaMm2?: number;
  sourceCutAreaMm2?: number;
  camPasses: number;
  fragileLandCount?: number;
  fragileLandAreaMm2?: number;
  /** Lands narrower than one V half-width at full depth (half the fragile threshold). */
  fragileSoftCount?: number;
  findings: Finding[];
  mmPerUnit?: number;
  prepareMs: number;
}

const boilerplate = [/^Contours are simplified/, /^Geometric checks do not establish/];
const ringArea = (loop: Loop) =>
  loop.reduce((sum, p, i) => {
    const q = loop[(i + 1) % loop.length];
    return sum + p.x * q.y - q.x * p.y;
  }, 0) / 2;
const perimeter = (loop: Loop) => loop.reduce((sum, p, i) => sum + Math.hypot(loop[(i + 1) % loop.length].x - p.x, loop[(i + 1) % loop.length].y - p.y), 0);

/** Accepted: it sanitizes, the preparation report has no errors, and cleanup removes at most 10% of the cut area. */
export async function evaluateSvg(svg: string, widthMm: number, heightMm: number, detail: CarvingDetail = 'balanced'): Promise<Evaluation> {
  const started = performance.now();
  let clean: string;
  try {
    clean = sanitizeCarvingSvg(svg);
  } catch (error) {
    return {
      sanitizeError: error instanceof Error ? error.message : String(error),
      ok: false,
      accepted: false,
      errors: [],
      warnings: [],
      substantiveWarnings: 0,
      camPasses: 0,
      findings: [],
      prepareMs: performance.now() - started,
    };
  }
  let prepared;
  try {
    prepared = await prepareCarvingArt({
      art: { kind: 'svg', fileName: 'live.svg', svg: clean },
      width: widthMm,
      height: heightMm,
      detail,
      carving: kLiveCarving,
      board: kLiveBoard,
      clearTool: kDefaultPlan.bit,
    });
  } catch (error) {
    return {
      ok: false,
      accepted: false,
      errors: [`prepare threw: ${error instanceof Error ? error.message : String(error)}`],
      warnings: [],
      substantiveWarnings: 0,
      camPasses: 0,
      findings: [],
      prepareMs: performance.now() - started,
    };
  }
  const { report } = prepared;
  const geometry = await locate(clean, widthMm, heightMm, report.minFeatureMm).catch(() => undefined);
  const removed = report.removedCutAreaFraction ?? 0;
  return {
    ok: report.ok,
    accepted: report.ok && removed <= 0.1,
    errors: report.errors,
    warnings: report.warnings,
    substantiveWarnings: report.warnings.filter(w => !boilerplate.some(re => re.test(w))).length,
    removedCutAreaFraction: report.removedCutAreaFraction,
    removedCutAreaMm2: report.removedCutAreaMm2,
    narrowLandAreaMm2: report.narrowLandAreaMm2,
    sourceCutAreaMm2: report.sourceCutAreaMm2,
    camPasses: report.camPasses,
    fragileLandCount: geometry?.fragileCount,
    fragileLandAreaMm2: geometry?.fragileArea,
    fragileSoftCount: geometry?.fragileSoftCount,
    findings: geometry?.findings ?? [],
    mmPerUnit: geometry?.mmPerUnit,
    prepareMs: performance.now() - started,
  };
}

/**
 * Repeats prepare's fit and its morphological opening/closing to find where the cut area is lost or the white land
 * is narrow, and maps each piece back to viewBox coordinates. Also the optional physical check: white lands
 * narrower than twice the V half-width at full depth (a closing at that radius), counted as fragile.
 */
async function locate(svg: string, widthMm: number, heightMm: number, minFeatureMm: number) {
  const vb = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement.getAttribute('viewBox')!.split(/[\s,]+/).map(Number);
  const drawn = await outlineArt({ kind: 'svg', fileName: 'live.svg', svg }, heightMm, { maxPixels: 750_000, maxMaskRuns: 20_000, simplifyPixels: 1 });
  const pts = drawn.region.flat();
  const x0 = Math.min(...pts.map(p => p.x)),
    x1 = Math.max(...pts.map(p => p.x)),
    y0 = Math.min(...pts.map(p => p.y)),
    y1 = Math.max(...pts.map(p => p.y));
  const scale = Math.min(widthMm / (x1 - x0), heightMm / (y1 - y0));
  const cx = (x0 + x1) / 2,
    cy = (y0 + y1) / 2;
  const outline = drawn.region.map(loop => loop.map(p => ({ x: (p.x - cx) * scale, y: (p.y - cy) * scale })));
  const vbPerRaw = vb[3] / heightMm;
  const mmPerUnit = scale / vbPerRaw;
  const toVb = (p: { x: number; y: number }): [number, number] => {
    const raw = { x: p.x / scale + cx, y: p.y / scale + cy };
    return [Number((vb[0] + vb[2] / 2 + raw.x * vbPerRaw).toFixed(1)), Number((vb[1] + vb[3] / 2 - raw.y * vbPerRaw).toFixed(1))];
  };
  const r = minFeatureMm / 2;
  const opened = offset(offset(outline, -r), r);
  const closed = offset(offset(outline, r), -r);
  const pieces = (loops: Loop[], kind: Finding['kind'], neededMm: number): Finding[] =>
    loops
      .filter(loop => Math.abs(ringArea(loop)) >= Math.max(0.05, 0.25 * minFeatureMm ** 2))
      .sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))
      .slice(0, 6)
      .map(loop => {
        const n = loop.length;
        const centre = { x: loop.reduce((s, p) => s + p.x, 0) / n, y: loop.reduce((s, p) => s + p.y, 0) / n };
        const xs = loop.map(p => p.x),
          ys = loop.map(p => p.y);
        return {
          kind,
          at: toVb(centre),
          measuredWidth: Number(((2 * Math.abs(ringArea(loop))) / perimeter(loop) / mmPerUnit).toFixed(1)),
          neededWidth: Number((neededMm / mmPerUnit).toFixed(1)),
          extent: Number((Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / mmPerUnit).toFixed(1)),
          units: 'viewBox' as const,
        };
      });
  const half = Math.min(kLiveCarving.maxDepth, kDefaultVBit.diameter / 2 / Math.tan(Math.PI / 6)) * Math.tan(Math.PI / 6);
  const fragile = difference(offset(offset(outline, half), -half), outline).filter(loop => Math.abs(ringArea(loop)) >= half * half);
  return {
    mmPerUnit,
    // Ask for twice the threshold: a stroke exactly at it still loses its tips and corners to the opening.
    findings: [...pieces(difference(outline, opened), 'removed-black', 2 * minFeatureMm), ...pieces(difference(closed, outline), 'narrow-white', 2 * minFeatureMm)],
    fragileCount: fragile.length,
    fragileArea: Math.max(0, polyArea(fragile)),
    fragileSoftCount: difference(offset(offset(outline, half / 2), -half / 2), outline).filter(loop => Math.abs(ringArea(loop)) >= half * half / 4).length,
  };
}

export const kDetail: CarvingDetail = 'balanced';
export const kMinFeature = carvingDetailMm[kDetail];
