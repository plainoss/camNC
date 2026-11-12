import { placeItem, withItems, type CarvingItemV1 } from '../carving';
import type { CamJobV1 } from '../jobDb';
import { kDefaultPlan } from '../planSettings';
import { carvingBounds } from '../carvingView';
import type { prepareCarvingArt } from './prepare';

type Prepared = Awaited<ReturnType<typeof prepareCarvingArt>>;
export interface CarvingSourceAsset {
  id: string;
  svg: string;
  prompt: string;
  summary: string;
  rasterPreview?: { dataUri: string; width: number; height: number };
  warnings?: string[];
}
export interface CarvingProposal {
  jobId: string;
  base: string;
  item: CarvingItemV1;
  mode: 'add' | 'replace';
  report: Prepared['report'];
}

/** Exact source comparison protects Apply even when an edit and click happen before another render. */
export function carvingProposalBase(job: CamJobV1): string {
  return JSON.stringify({ id: job.id, carving: job.carving, boards: job.boards, plan: job.plan });
}

function signature(text: string): string {
  let first = 2166136261;
  let second = 5381;
  for (let i = 0; i < text.length; i++) {
    first = Math.imul(first ^ text.charCodeAt(i), 16777619);
    second = Math.imul(second, 33) ^ text.charCodeAt(i);
  }
  return `${text.length}:${first >>> 0}:${second >>> 0}`;
}

/** A compact change detector, not an authorization token. Apply uses the exact base above. */
export function carvingSuitabilityKey(job: CamJobV1, item: CarvingItemV1): string {
  const carving = job.carving;
  const board = job.boards?.[0];
  return signature(
    JSON.stringify({
      version: 1,
      art: item.art,
      outline: item.outline,
      height: item.height,
      x: item.x,
      y: item.y,
      rotation: item.rotation,
      tool: carving?.vBit,
      maxDepth: carving?.maxDepth,
      clearWithFlat: carving?.clearWithFlat,
      material: (job.plan ?? kDefaultPlan).material,
      flat: carving?.clearWithFlat ? (job.plan ?? kDefaultPlan).bit : undefined,
      board: board && {
        size: board.size,
        thickness: board.thickness,
        measuredThickness: board.measuredThickness,
        material: board.material,
        margin: board.margin,
        fixtures: board.fixtures,
      },
    })
  );
}

/**
 * The size to fit the saved source into when it is rechecked: its original envelope, scaled by any later height
 * edit. Fitting into the accepted ink size instead would shrink artwork whose cleanup removed outlying specks.
 */
export function savedCarvingEnvelope(
  saved: NonNullable<CarvingItemV1['generated']>,
  itemHeight = saved.height
): { width: number; height: number } {
  const scale = itemHeight / saved.height;
  const envelope = saved.envelope ?? saved;
  return { width: envelope.width * scale, height: envelope.height * scale };
}

export function generatedCarvingProblem(job: CamJobV1): string | null {
  const stale = job.carving?.items.find(item => item.generated && item.generated.checkedFor !== carvingSuitabilityKey(job, item));
  return stale
    ? 'Generated artwork changed size, placement or cutting settings. Recheck it in the carving assistant before planning.'
    : null;
}

function itemFits(job: CamJobV1, item: CarvingItemV1): boolean {
  const board = job.boards?.[0];
  if (!board || board.size.fit) return false;
  const { w, h } = board.size;
  const margin = Math.max(0, board.margin ?? 0);
  return placeItem(item).every(loop =>
    loop.every(
      p => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= margin && p.y >= margin && p.x <= w - margin && p.y <= h - margin
    )
  );
}

/** Candidate positions touch existing boxes or board edges; prefer the closest clear position to the center. */
function clearPlacement(job: CamJobV1, item: CarvingItemV1): { x: number; y: number } {
  const board = job.boards![0];
  if (board.size.fit) throw new Error('Choose a fixed board size.');
  const boardSize = board.size;
  const own = carvingBounds(item.outline)!;
  const taken = job.carving!.items.flatMap(other => {
    const box = carvingBounds(placeItem(other));
    return box ? [box] : [];
  });
  const margin = Math.max(0, board.margin ?? 0),
    gap = 2;
  const xs = [
    board.size.w / 2,
    margin - own.x0,
    board.size.w - margin - own.x1,
    ...taken.flatMap(box => [box.x0 - gap - own.x1, box.x1 + gap - own.x0]),
  ];
  const ys = [
    board.size.h / 2,
    margin - own.y0,
    board.size.h - margin - own.y1,
    ...taken.flatMap(box => [box.y0 - gap - own.y1, box.y1 + gap - own.y0]),
  ];
  // Bound the position search even for jobs containing hundreds of existing items.
  const nearest = (values: number[], center: number) =>
    [...new Set(values)].sort((a, b) => Math.abs(a - center) - Math.abs(b - center)).slice(0, 64);
  const candidates = nearest(xs, item.x)
    .flatMap(x => nearest(ys, item.y).map(y => ({ x, y })))
    .sort((a, b) => Math.hypot(a.x - item.x, a.y - item.y) - Math.hypot(b.x - item.x, b.y - item.y));
  const found = candidates.find(at => {
    const box = { x0: own.x0 + at.x, x1: own.x1 + at.x, y0: own.y0 + at.y, y1: own.y1 + at.y };
    if (box.x0 < margin || box.y0 < margin || box.x1 > boardSize.w - margin || box.y1 > boardSize.h - margin) return false;
    return taken.every(
      other => box.x1 + gap <= other.x0 || other.x1 + gap <= box.x0 || box.y1 + gap <= other.y0 || other.y1 + gap <= box.y0
    );
  });
  if (!found)
    throw new Error('There is no clear space for this artwork. Reduce its size, move existing items, or replace the selected artwork.');
  return found;
}

export function createCarvingProposal(
  job: CamJobV1,
  prepared: Prepared,
  options: {
    mode: 'add' | 'replace';
    targetId?: string;
    asset: CarvingSourceAsset;
    detail: 'simple' | 'balanced' | 'detailed';
    /** Where the artwork's centre goes on the board (mm, Y up). Without it, an addition takes the nearest clear spot. */
    at?: { x: number; y: number };
  }
): CarvingProposal {
  const board = job.boards?.[0];
  if (!job.carving || !board || board.size.fit) throw new Error('Open a carving with a fixed board first.');
  if (!prepared.report.ok || !prepared.outline.length) throw new Error('Resolve the carving checks before offering a proposal.');
  const target = options.mode === 'replace' ? job.carving.items.find(item => item.id === options.targetId) : undefined;
  if (options.mode === 'replace' && !target) throw new Error('Select the artwork to replace.');
  const item: CarvingItemV1 = {
    id: target?.id ?? crypto.randomUUID(),
    art: structuredClone(prepared.art),
    height: prepared.height,
    x: options.at?.x ?? target?.x ?? board.size.w / 2,
    y: options.at?.y ?? target?.y ?? board.size.h / 2,
    rotation: target?.rotation ?? 0,
    outline: structuredClone(prepared.outline),
    generated: {
      assetId: options.asset.id,
      sourceSvg: options.asset.svg,
      prompt: options.asset.prompt,
      summary: options.asset.summary,
      ...(options.asset.rasterPreview && { sourceRaster: structuredClone(options.asset.rasterPreview) }),
      ...(options.asset.warnings && { warnings: [...options.asset.warnings] }),
      detail: options.detail,
      width: prepared.width,
      height: prepared.height,
      envelope: { ...prepared.envelope },
      checkedFor: '',
    },
  };
  if (options.mode === 'add' && !options.at) Object.assign(item, clearPlacement(job, item));
  if (!itemFits(job, item)) throw new Error('The artwork does not fit on the board here. Move the dashed box or make it smaller.');
  const placed = carvingBounds(placeItem(item))!;
  if (
    job.carving.items.some(other => {
      if (other.id === target?.id) return false;
      const box = carvingBounds(placeItem(other));
      return box && placed.x0 < box.x1 && placed.x1 > box.x0 && placed.y0 < box.y1 && placed.y1 > box.y0;
    })
  )
    throw new Error('The artwork overlaps another item. Move the dashed box to a clear spot or make it smaller.');
  item.generated!.checkedFor = carvingSuitabilityKey(job, item);
  return { jobId: job.id, base: carvingProposalBase(job), mode: options.mode, item, report: structuredClone(prepared.report) };
}

export function carvingProposalRefusal(job: CamJobV1, proposal: CarvingProposal): string | null {
  if (job.id !== proposal.jobId || !job.carving) return 'This proposal belongs to another carving.';
  if (carvingProposalBase(job) !== proposal.base) return 'The carving or board changed. Recheck the artwork before applying.';
  if (!proposal.report.ok || proposal.report.errors.length || !itemFits(job, proposal.item))
    return 'The artwork has unresolved carving checks.';
  if (proposal.mode === 'replace' && !job.carving.items.some(item => item.id === proposal.item.id))
    return 'The artwork to replace no longer exists.';
  if (proposal.mode === 'add' && job.carving.items.some(item => item.id === proposal.item.id)) return 'This artwork was already added.';
  return null;
}

export function applyCarvingProposal(job: CamJobV1, proposal: CarvingProposal): CamJobV1 {
  const refusal = carvingProposalRefusal(job, proposal);
  if (refusal) throw new Error(refusal);
  const items =
    proposal.mode === 'replace'
      ? job.carving!.items.map(item => (item.id === proposal.item.id ? structuredClone(proposal.item) : item))
      : [...job.carving!.items, structuredClone(proposal.item)];
  return { ...job, carving: withItems(job.carving!, items) };
}
