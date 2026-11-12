import { simplifyLoop, vConeDepth, type Operation, type LibraryTool } from '@wbcnc/cam';
import type { BoardV1 } from '../boards';
import type { CarvingArt, CarvingV1 } from '../carving';
import { outlineArt } from '../carvingOutline';
import { sanitizeCarvingSvg } from './sanitize';
import { checkCarvingInWorker } from './camCheck';
import { offset, difference, polyArea } from '../../../../../packages/cam/src/geom';
import { carvingWork } from '../../../../../packages/cam/src/vcarve';
import { kMaxOutlinePoints } from './curveFlatten';

export type Loop = { x: number; y: number }[];
export type CarvingDetail = 'simple' | 'balanced' | 'detailed';
/** Visual preparation thresholds, not a material or machine accuracy certificate. */
export const carvingDetailMm: Record<CarvingDetail, number> = { simple: 1, balanced: 0.6, detailed: 0.3 };
/**
 * Share of the requested envelope that is carved (black). Above these a V-carve stops reading as a drawing and
 * turns into a slow, nearly solid pocket; live generations occasionally returned such near-solid art.
 */
export const kCarvedFractionWarn = 0.6;
export const kCarvedFractionError = 0.85;
// After detail preparation a detailed 1024 px illustration carved at 100 mm keeps about 7000 points. The CAM check's
// own work estimate (`carvingWork`) bounds the rings times points, so this only stops geometry that could never pass.
const kMaxCamPoints = 12_000;
export interface CarvingPreparationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  detail: CarvingDetail;
  minFeatureMm: number;
  removedComponents: number;
  sourceComponents: number;
  points: number;
  camPasses: number;
  removedCutAreaMm2: number;
  narrowLandAreaMm2: number;
  sourceCutAreaMm2?: number;
  removedCutAreaFraction?: number;
  /** Carved (black) area of the accepted outline divided by the requested width × height envelope, 0–1. */
  carvedFraction?: number;
}
export interface PreparedCarvingArt {
  art: CarvingArt;
  outline: Loop[];
  width: number;
  height: number;
  /** Maximum size the whole source was fitted into; cleanup can leave the accepted ink smaller. */
  envelope: { width: number; height: number };
  report: CarvingPreparationReport;
  operations: Operation[];
  /** Where detail cleanup removed cut area or found narrow lands, in the same centred mm as `outline`; largest first. */
  problemAreas?: CarvingProblemArea[];
}
export interface CarvingProblemArea {
  x: number;
  y: number;
  r: number;
  kind: 'removed' | 'narrow';
}
export interface PrepareCarvingArtOptions {
  art: CarvingArt;
  width: number;
  height: number;
  detail: CarvingDetail;
  carving: CarvingV1;
  board: BoardV1;
  signal?: AbortSignal;
  clearTool?: LibraryTool;
  /** Internal, independently checked smooth PNG trace; centered physical mm with <=0.015 mm chord error. */
  sourceOutline?: Loop[];
}
const area = (loop: Loop) =>
  loop.reduce((sum, p, i) => {
    const q = loop[(i + 1) % loop.length];
    return sum + p.x * q.y - q.x * p.y;
  }, 0) / 2;
const bounds = (loops: Loop[]) => {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of loops.flat()) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
};
const abort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Artwork preparation stopped.', 'AbortError');
};
const yieldToStop = async (signal?: AbortSignal) => {
  await new Promise(resolve => setTimeout(resolve, 0));
  abort(signal);
};

/** The accepted polygon source can be reopened without provider access or executing markup. */
export function carvingOutlineSvg(outline: Loop[]): string {
  const box = bounds(outline);
  const path = outline.map(loop => loop.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(4)},${(-p.y).toFixed(4)}`).join('') + 'Z').join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.x0} ${-box.y1} ${box.w} ${box.h}"><path fill="black" fill-rule="nonzero" d="${path}"/></svg>`;
}

/** Prepare a fresh candidate. The caller keeps original source for future size/detail changes. No job is mutated. */
export async function prepareCarvingArt(options: PrepareCarvingArtOptions): Promise<PreparedCarvingArt> {
  const { art, width, height, detail, carving, board, signal } = options;
  abort(signal);
  if (![width, height].every(n => Number.isFinite(n) && n >= 2 && n <= 500)) throw new Error('Artwork width and height must be 2–500 mm.');
  if (!Object.hasOwn(carvingDetailMm, detail)) throw new Error('Unknown carving detail level.');
  if (!Number.isFinite(board.thickness) || board.thickness <= 0) throw new Error('The board needs a positive finite thickness.');
  const source: CarvingArt = art.kind === 'svg' ? { ...art, svg: sanitizeCarvingSvg(art.svg) } : art;
  if (source.kind === 'text' && source.text.length > 1000) throw new Error('Artwork text is too long.');
  await yieldToStop(signal);
  if (
    options.sourceOutline &&
    (options.sourceOutline.length > 500 ||
      options.sourceOutline.reduce((sum, loop) => sum + loop.length, 0) > kMaxOutlinePoints ||
      options.sourceOutline.some(
        loop =>
          loop.length < 3 ||
          loop.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 10_000 || Math.abs(p.y) > 10_000)
      ))
  )
    throw new Error('Smooth source outlines are invalid or exceed the geometry budget.');
  const drawn = options.sourceOutline
    ? { region: structuredClone(options.sourceOutline) }
    : await outlineArt(source, height, { maxPixels: 750_000, maxMaskRuns: 20_000, simplifyPixels: 1 });
  abort(signal);
  const box = bounds(drawn.region);
  if (!Number.isFinite(box.w) || box.w <= 0 || box.h <= 0) throw new Error('Artwork has no dark filled shapes to carve.');
  // Outlines of model-written SVG keep the lower limit: their cleanup below runs on the main thread.
  if (
    drawn.region.length > 500 ||
    drawn.region.reduce((sum, loop) => sum + loop.length, 0) > (options.sourceOutline ? kMaxOutlinePoints : 8000)
  )
    throw new Error('Artwork is too complex. Request fewer details or simpler filled shapes.');
  const scale = Math.min(width / box.w, height / box.h);
  let outline = drawn.region.map(loop =>
    loop.map(p => ({ x: (p.x - (box.x0 + box.x1) / 2) * scale, y: (p.y - (box.y0 + box.y1) / 2) * scale }))
  );
  const sourceOutline = outline;
  const report: CarvingPreparationReport = {
    ok: false,
    errors: [],
    warnings: [],
    detail,
    minFeatureMm: carvingDetailMm[detail],
    removedComponents: 0,
    sourceComponents: outline.filter(loop => area(loop) > 0).length,
    points: 0,
    camPasses: 0,
    removedCutAreaMm2: 0,
    narrowLandAreaMm2: 0,
    sourceCutAreaMm2: polyArea(sourceOutline),
  };
  // Remove only isolated small regions. Holes remain: silently closing an eye or letter counter changes its meaning.
  const small = outline.filter(loop => area(loop) > 0 && Math.abs(area(loop)) < report.minFeatureMm ** 2);
  if (small.length) {
    // A hole inside a removed island cannot be retained on its own. Skip cleanup if the drawing has holes.
    if (outline.some(loop => area(loop) < 0))
      report.warnings.push(`${small.length} small filled regions need visual review; holes were preserved.`);
    else {
      outline = outline.filter(loop => !small.includes(loop));
      report.removedComponents = small.length;
      report.warnings.push(
        `Removed ${small.length} isolated filled regions smaller than ${report.minFeatureMm} × ${report.minFeatureMm} mm in area.`
      );
    }
  }
  if (!outline.length) {
    report.errors.push('All filled regions are below this detail level. Enlarge the artwork or choose more detail.');
    outline = drawn.region.map(loop =>
      loop.map(p => ({ x: (p.x - (box.x0 + box.x1) / 2) * scale, y: (p.y - (box.y0 + box.y1) / 2) * scale }))
    );
  }
  const beforeOpening = outline;
  const radius = report.minFeatureMm / 2;
  const simplifyTolerance = options.sourceOutline ? Math.min(0.025, Math.max(0.001, 0.05 - 0.015 * scale)) : report.minFeatureMm / 12;
  if (options.sourceOutline && 0.015 * scale >= 0.049)
    report.errors.push('Re-trace the original PNG at this larger size to preserve its curve approximation tolerance.');
  // Physical-scale opening removes narrow branches as well as isolated dots; closing detects narrow uncut gaps.
  // These are approximate geometric feature tests. Always report changed area rather than claiming semantic equivalence.
  // Round offsets tessellate every raster corner. Reduce them again within 1/12 of the physical feature threshold,
  // otherwise a compact curved drawing becomes thousands of nearly collinear CAM vertices.
  const opened = offset(offset(outline, -radius), radius)
    .map(loop => simplifyLoop(loop, simplifyTolerance))
    .filter(loop => loop.length >= 3);
  const closed = offset(offset(outline, radius), -radius);
  const removedLoops = difference(sourceOutline, opened);
  const narrowLoops = difference(closed, beforeOpening);
  report.removedCutAreaMm2 = Math.max(0, polyArea(removedLoops));
  report.narrowLandAreaMm2 = Math.max(0, polyArea(narrowLoops));
  report.removedCutAreaFraction = Math.min(1, report.removedCutAreaMm2 / Math.max(1e-9, polyArea(sourceOutline)));
  if (opened.length) outline = opened;
  else report.errors.push('No filled regions survive the selected physical detail threshold.');
  report.removedComponents = Math.max(0, report.sourceComponents - opened.filter(loop => area(loop) > 0).length);
  if (report.removedCutAreaMm2 > 0.01)
    report.warnings.push(
      `Detail preparation removed ${report.removedCutAreaMm2.toFixed(2)} mm² of cut area, including narrow branches or corners. Compare the artwork before applying.`
    );
  if (report.removedCutAreaFraction > 0.1)
    report.warnings.push(
      'This detail level removes more than 10% of the original cut area. Important features may be missing; use a finer detail level or larger size if needed.'
    );
  if (report.removedCutAreaFraction > 0.5)
    report.errors.push(
      'This size and detail level remove more than half of the original artwork. Choose a larger size or finer detail level.'
    );
  report.carvedFraction = Math.min(1, Math.max(0, polyArea(outline)) / (width * height));
  const carvedMessage = carvedFractionMessage(report.carvedFraction);
  if (report.carvedFraction > kCarvedFractionError) report.errors.push(carvedMessage);
  else if (report.carvedFraction > kCarvedFractionWarn) report.warnings.push(carvedMessage);
  if (report.narrowLandAreaMm2 > 0.01)
    report.warnings.push(
      `Approximately ${report.narrowLandAreaMm2.toFixed(2)} mm² of narrow remaining gaps or lands need review at the ${report.minFeatureMm} mm threshold. They were not filled automatically.`
    );
  report.warnings.push(
    `Contours are simplified within ${simplifyTolerance.toFixed(3)} mm after physical detail preparation.${options.sourceOutline ? ' Smooth-source CAM chord approximation stays within 0.05 mm; detail cleanup is reported separately.' : ''}`
  );
  const accepted = bounds(outline);
  // Keep the final ink centered even if cleanup removed an outlying dot.
  outline = outline.map(loop => loop.map(p => ({ x: p.x - (accepted.x0 + accepted.x1) / 2, y: p.y - (accepted.y0 + accepted.y1) / 2 })));
  const centre = { x: (accepted.x0 + accepted.x1) / 2, y: (accepted.y0 + accepted.y1) / 2 };
  const problemAreas = [
    ...problemSpots(removedLoops, 'removed', report.minFeatureMm),
    ...problemSpots(narrowLoops, 'narrow', report.minFeatureMm),
  ]
    .sort((a, b) => b.r - a.r)
    .slice(0, 12)
    .map(spot => ({ ...spot, x: spot.x - centre.x, y: spot.y - centre.y }));
  report.points = outline.reduce((sum, loop) => sum + loop.length, 0);
  if (board.size.fit || ![board.size.w, board.size.h].every(n => Number.isFinite(n) && n > 0))
    report.errors.push('Carving requires a fixed board size.');
  else if (accepted.w > board.size.w + 1e-6 || accepted.h > board.size.h + 1e-6) report.errors.push('Artwork does not fit on the board.');
  const tip = carving.vBit.tipDiameter ?? 0;
  if (tip > 0) {
    const tipReachable = offset(offset(outline, -tip / 2), tip / 2);
    const tipLost = Math.max(0, polyArea(difference(outline, tipReachable)));
    if (tipLost > 0.01)
      report.warnings.push(
        `The ${tip} mm V-bit tip may leave approximately ${tipLost.toFixed(2)} mm² uncut in thin branches or tight corners. Inspect the actual toolpath preview.`
      );
  }
  const narrow = outline.filter(loop => area(loop) > 0 && Math.min(bounds([loop]).w, bounds([loop]).h) <= tip).length;
  if (narrow) report.errors.push(`${narrow} filled regions are no wider than the V-bit tip and cannot be carved faithfully.`);
  if (outline.some(loop => Math.min(bounds([loop]).w, bounds([loop]).h) < report.minFeatureMm))
    report.warnings.push(
      `Some regions are narrower than the ${report.minFeatureMm} mm detail threshold. Inspect small features and remaining gaps.`
    );
  report.warnings.push(
    'Geometric checks do not establish material strength, visual fidelity or machine acceptance. Review Plan before cutting.'
  );
  await yieldToStop(signal);
  // Bound synchronous CAM work: noisy model output must not monopolize the UI with thousands of offset rings.
  const cap = Math.min(carving.maxDepth, vConeDepth(carving.vBit));
  const camInput = {
    id: 'assistant-preview',
    name: 'Generated artwork',
    region: outline,
    tool: carving.vBit,
    maxDepth: carving.maxDepth,
    ...(carving.clearWithFlat && options.clearTool && { clearTool: options.clearTool }),
  };
  let operations: Operation[] = [];
  if (report.points > kMaxCamPoints || !Number.isFinite(cap) || cap <= 0 || cap > 8 || Math.min(accepted.w, accepted.h) > 250)
    report.errors.push('Artwork exceeds the bounded assistant CAM check. Use smaller or simpler artwork or a shallower depth.');
  // CAM's estimator measures the region's actual widest interior with bounded offset probes. Overall artwork
  // dimensions are a poor floor-ring estimate for line illustrations: an 80 mm face can have only 2 mm strokes.
  else if (carvingWork(camInput) / 0.07 > 800_000)
    report.errors.push('Artwork exceeds the bounded assistant CAM check. Use smaller or simpler artwork or a shallower depth.');
  else if (!report.errors.length) {
    try {
      operations = await checkCarvingInWorker(camInput, board.thickness, signal);
      abort(signal);
      report.camPasses = operations.reduce((sum, operation) => sum + operation.passes.length, 0);
      if (!report.camPasses) report.errors.push('The current V-bit produces no cuts for this artwork.');
      report.warnings.push(...operations.flatMap(operation => operation.warnings ?? []));
    } catch (error) {
      if (signal?.aborted) throw error;
      report.errors.push(error instanceof Error ? error.message : 'The CAM check failed.');
    }
  }
  report.ok = report.errors.length === 0;
  return {
    art: { kind: 'svg', fileName: source.kind === 'svg' ? source.fileName : 'generated-artwork.svg', svg: carvingOutlineSvg(outline) },
    outline,
    width: accepted.w,
    height: accepted.h,
    envelope: { width, height },
    report,
    operations,
    problemAreas,
  };
}

function carvedFractionMessage(fraction: number): string {
  const limit = fraction > kCarvedFractionError ? kCarvedFractionError : kCarvedFractionWarn;
  return `Most of the drawing is carved away (${Math.round(fraction * 100)}%, limit ${Math.round(limit * 100)}%). Ask for an outline or line-art style, or use white for the background.`;
}

/**
 * One circle per compact lost or narrow piece, so the board can point at it instead of a checkbox. Long slivers
 * along an outline are a shape change, not a spot; the report counts their area.
 */
function problemSpots(loops: Loop[], kind: CarvingProblemArea['kind'], minFeatureMm: number): CarvingProblemArea[] {
  const least = Math.max(0.02, 0.25 * minFeatureMm ** 2),
    widest = Math.max(3, 8 * minFeatureMm);
  return loops.flatMap(loop => {
    const box = bounds([loop]);
    const diagonal = Math.hypot(box.w, box.h);
    if (Math.abs(area(loop)) < least || diagonal > widest) return [];
    return [{ x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2, r: Math.max(minFeatureMm * 2, diagonal / 2 + minFeatureMm), kind }];
  });
}
