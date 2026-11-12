import { kCarvingBoard, placeItem } from '../carving';
import { carvingBounds } from '../carvingView';
import type { CamJobV1 } from '../jobDb';
import { kDefaultPlan } from '../planSettings';
import type { GeneratedCarvingAsset } from './generation';
import { carvingDetailMm, prepareCarvingArt, type CarvingDetail, type PreparedCarvingArt } from './prepare';
import { createCarvingProposal, savedCarvingEnvelope, type CarvingProposal } from './proposal';
import { boundedCarvingRasterPreview, traceCarvingPng } from './rasterSource';

/** The dashed box on the board: the artwork's centre and the size it is fitted into, board mm with Y up. */
export interface CarvingTarget {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type CarvingStyle = 'line' | 'bold';
export interface CarvingVariant {
  id: string;
  status: 'generating' | 'ready' | 'failed';
  asset?: GeneratedCarvingAsset;
  /** The preparation key a raster asset's smooth outline was traced for; other sizes trace the PNG again. */
  tracedFor?: string;
  result?: PreparedVariant;
  error?: string;
}
export interface PreparedVariant {
  key: string;
  asset: GeneratedCarvingAsset;
  prepared: PreparedCarvingArt;
  proposal: CarvingProposal | null;
  /** Why a checked artwork cannot be placed at the box, e.g. an overlap. */
  refusal?: string;
}

export const kVariantCounts = [1, 2, 4] as const;
const kLeast = 10;

export function boardSize(job: CamJobV1) {
  const size = job.boards?.[0]?.size;
  return size && !size.fit ? { w: size.w, h: size.h } : kCarvingBoard;
}

/** Keep the box on the board and at a size preparation accepts. */
export function clampTarget(target: CarvingTarget, board: { w: number; h: number }): CarvingTarget {
  const w = Math.max(kLeast, Math.min(target.w, board.w, 500));
  const h = Math.max(kLeast, Math.min(target.h, board.h, 500));
  return {
    w,
    h,
    x: Math.max(w / 2, Math.min(board.w - w / 2, target.x)),
    y: Math.max(h / 2, Math.min(board.h - h / 2, target.y)),
  };
}

/** A selected generated item is reworked where it is; otherwise the box starts in the nearest clear spot. */
export function initialTarget(job: CamJobV1, selectedId?: string | null): { target: CarvingTarget; replace: boolean } {
  const board = boardSize(job);
  const items = job.carving?.items ?? [];
  const selected = items.find(item => item.id === selectedId);
  if (selected?.generated) {
    const box = carvingBounds(placeItem(selected));
    const envelope = savedCarvingEnvelope(selected.generated, selected.height);
    const centre = box ? { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 } : { x: selected.x, y: selected.y };
    return { target: clampTarget({ ...centre, w: envelope.width, h: envelope.height }, board), replace: true };
  }
  const w = Math.round(Math.min(100, board.w * 0.4)),
    h = Math.round(Math.min(100, board.h * 0.7));
  return { target: clampTarget(clearBox(items, w, h, board), board), replace: false };
}

/**
 * The biggest box, up to w × h, that stays clear of the items already on the board; the nearest to the centre of
 * those. A full board gives the centre at full size, where Apply then reports the overlap.
 */
function clearBox(items: NonNullable<CamJobV1['carving']>['items'], w: number, h: number, board: { w: number; h: number }): CarvingTarget {
  const taken = items.map(item => carvingBounds(placeItem(item))).filter(box => !!box);
  const gap = 3,
    step = 5;
  const sizes = [1, 0.8, 0.65, 0.5, 0.35].flatMap(k => [
    { w: w * k, h: h * k },
    { w: w * k, h: h * k * 0.6 },
    { w: w * k * 0.6, h: h * k },
  ]);
  let best = null as (CarvingTarget & { score: number }) | null;
  for (const size of sizes) {
    if (size.w < kLeast || size.h < kLeast) continue;
    for (let x = size.w / 2 + gap; x <= board.w - size.w / 2 - gap; x += step)
      for (let y = size.h / 2 + gap; y <= board.h - size.h / 2 - gap; y += step) {
        const box = { x0: x - size.w / 2, x1: x + size.w / 2, y0: y - size.h / 2, y1: y + size.h / 2 };
        if (!taken.every(t => box.x1 + gap <= t.x0 || t.x1 + gap <= box.x0 || box.y1 + gap <= t.y0 || t.y1 + gap <= box.y0)) continue;
        const score = size.w * size.h * 1000 - Math.hypot(x - board.w / 2, y - board.h / 2);
        if (!best || score > best.score) best = { x, y, w: Math.round(size.w), h: Math.round(size.h), score };
      }
    if (best) break;
  }
  return best ? { x: best.x, y: best.y, w: best.w, h: best.h } : { x: board.w / 2, y: board.h / 2, w, h };
}

/** The brief sent for one variant; the user's own words stay the asset's saved prompt. */
export function variantBrief(prompt: string, style: CarvingStyle, index: number, count: number): string {
  const lines = [prompt.trim()];
  lines.push(style === 'bold' ? 'Style: bold, broad filled shapes with few interior lines.' : 'Style: clean line art with filled strokes.');
  if (count > 1) lines.push(`Variant ${index + 1} of ${count}: choose a clearly different composition or pose from the other variants.`);
  return lines.join('\n');
}

export function preparationKey(
  job: CamJobV1,
  target: CarvingTarget,
  detail: CarvingDetail,
  mode: 'add' | 'replace',
  targetId?: string | null
) {
  const round = (n: number) => Math.round(n * 10) / 10;
  return JSON.stringify([
    round(target.x),
    round(target.y),
    round(target.w),
    round(target.h),
    detail,
    mode,
    mode === 'replace' ? targetId : null,
    job.id,
    job.carving,
    job.boards,
    job.plan,
  ]);
}

/** Fit one asset into the box, check it, and place it there. Never changes the job. */
export async function prepareVariant(options: {
  job: CamJobV1;
  variant: CarvingVariant;
  target: CarvingTarget;
  detail: CarvingDetail;
  mode: 'add' | 'replace';
  targetId?: string | null;
  signal: AbortSignal;
}): Promise<PreparedVariant> {
  const { job, variant, target, detail, mode, targetId, signal } = options;
  const carving = job.carving,
    board = job.boards?.[0];
  if (!carving || !board) throw new Error('Open a carving with a board first.');
  let asset = variant.asset!;
  const key = preparationKey(job, target, detail, mode, targetId);
  const constraints = { widthMm: target.w, heightMm: target.h, detail, minFeatureMm: carvingDetailMm[detail] };
  if (asset.rasterPreview && variant.tracedFor !== traceKey(target, detail)) {
    const raster = boundedCarvingRasterPreview(asset.rasterPreview);
    if (!raster) throw new Error('The saved raster source is invalid or exceeds the image limits.');
    const traced = await traceCarvingPng(raster.slice(raster.indexOf(',') + 1), constraints, signal);
    asset = { ...asset, svg: traced.svg, warnings: traced.warnings, sourceOutline: traced.sourceOutline };
  }
  const prepared = await prepareCarvingArt({
    art: { kind: 'svg', svg: asset.svg, fileName: 'Assistant artwork.svg' },
    width: target.w,
    height: target.h,
    detail,
    carving,
    board,
    clearTool: (job.plan ?? kDefaultPlan).bit,
    sourceOutline: asset.rasterPreview ? asset.sourceOutline : undefined,
    signal,
  });
  prepared.report.warnings.unshift(...(asset.warnings ?? []));
  if (!prepared.report.ok) return { key, asset, prepared, proposal: null };
  try {
    const proposal = createCarvingProposal(job, prepared, {
      mode,
      ...(mode === 'replace' && targetId && { targetId }),
      asset,
      detail,
      at: { x: target.x, y: target.y },
    });
    return { key, asset, prepared, proposal };
  } catch (cause) {
    return { key, asset, prepared, proposal: null, refusal: cause instanceof Error ? cause.message : 'This artwork cannot go here.' };
  }
}

export const traceKey = (target: CarvingTarget, detail: CarvingDetail) =>
  JSON.stringify([Math.round(target.w * 10), Math.round(target.h * 10), detail]);
