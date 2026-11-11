/**
 * Live provider runs of the carving generator, each drawing checked with the app's own carving preparation.
 * Opt in from apps/camNC: CARVE_LIVE=1 pnpm vitest run --config live-carve.vitest.config.ts
 * Settings and output: src/test/live/README.md.
 */
import { commands } from '@vitest/browser/context';
import { describe, expect, it } from 'vitest';
import { requestAssistant } from '@/cad/assistant/provider';
import { kLivePlaceholderKey, liveEnv, liveFetch, liveProvider } from '@/test/live/page';
import { generateCarvingAsset, type CarvingGenerationOptions } from '../generation';
import { variantBrief } from '../session';
import { evaluateSvg, kDetail, kMinFeature, type Evaluation } from './evaluate';
import { repairBrief } from './repair';

/** Fixed brief set: subject, size (mm) and a stable id. Default detail (balanced), line style, as the app sends them. */
const kBriefs = [
  { id: 'owl', w: 80, h: 80, prompt: 'A charming owl perched on a branch, big round eyes, folded wings.' },
  {
    id: 'mouse-ball',
    w: 150,
    h: 150,
    prompt: 'A cute mouse playing with a ball: rounded ears, curious face, paws reaching for the ball, curved tail.',
  },
  { id: 'plaque', w: 150, h: 60, prompt: 'A name plaque reading "EMMA" in bold letters with a small star on each side.' },
  { id: 'tree', w: 150, h: 150, prompt: 'A detailed oak tree with a strong trunk, spreading branches and leafy crown.' },
  { id: 'cat', w: 80, h: 80, prompt: 'A sitting cat silhouette seen from the side, tail curled around its paws.' },
  { id: 'celtic-knot', w: 80, h: 80, prompt: 'A square celtic knot with interlaced over-under bands.' },
  { id: 'fish', w: 150, h: 150, prompt: 'A fish with scales, fins and an eye, swimming among a few bubbles.' },
  { id: 'mountains', w: 150, h: 80, prompt: 'A mountain landscape: three peaks with snow caps, a sun and a few pine trees in front.' },
];

const enabled = liveEnv.CARVE_LIVE === '1';
const label = liveEnv.CARVE_LIVE_LABEL ?? 'run';
const model = liveEnv.CARVE_LIVE_MODEL ?? 'gpt-5.4-mini';
const { config } = liveProvider(model);
const reps = Number(liveEnv.CARVE_LIVE_REPS ?? 2);
/** Label of an earlier run whose first drawings are re-evaluated with the current code instead of generated. */
const from = liveEnv.CARVE_LIVE_FROM;
const repair = liveEnv.CARVE_LIVE_REPAIR === '1';
const effort = liveEnv.CARVE_LIVE_EFFORT;
const maxOutputTokens = liveEnv.CARVE_LIVE_MAX_OUT ? Number(liveEnv.CARVE_LIVE_MAX_OUT) : undefined;
const concurrency = Number(liveEnv.CARVE_LIVE_CONCURRENCY ?? 4);
const only = liveEnv.CARVE_LIVE_BRIEFS?.split(',');

export interface LiveRecord {
  label: string;
  model: string;
  briefId: string;
  rep: number;
  phase: 'first' | 'repair';
  widthMm: number;
  heightMm: number;
  generationError?: string;
  svgChars?: number;
  title?: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  costUsd: number;
  latencyMs: number;
  evaluation?: Evaluation;
}

async function generate(prompt: string, w: number, h: number, tag: string, previous?: CarvingGenerationOptions['previous']) {
  let costUsd = 0;
  const fetcher = liveFetch({
    tag,
    extra: effort ? (model.startsWith('gemini') ? { reasoning_effort: effort } : { reasoning: { effort } }) : undefined,
    onCost: usd => (costUsd += usd),
  });
  const options: CarvingGenerationOptions = {
    prompt,
    constraints: { widthMm: w, heightMm: h, detail: kDetail, minFeatureMm: kMinFeature },
    credentials: { config, key: kLivePlaceholderKey },
    signal: AbortSignal.timeout(200_000),
    limits: { maxRequestMs: 180_000, ...(maxOutputTokens && { maxOutputTokens }), maxInputCharacters: 120_000 },
    request: request => requestAssistant(request, fetcher),
    ...(previous && { previous }),
  };
  const started = performance.now();
  try {
    const { asset, usage } = await generateCarvingAsset(options);
    return { asset, usage, costUsd, latencyMs: performance.now() - started };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), costUsd, latencyMs: performance.now() - started };
  }
}

async function record(
  brief: (typeof kBriefs)[number],
  rep: number,
  phase: LiveRecord['phase'],
  result: Awaited<ReturnType<typeof generate>>
): Promise<LiveRecord> {
  const base: LiveRecord = {
    label,
    model,
    briefId: brief.id,
    rep,
    phase,
    widthMm: brief.w,
    heightMm: brief.h,
    costUsd: result.costUsd,
    latencyMs: result.latencyMs,
  };
  if ('error' in result) return { ...base, generationError: result.error };
  const { asset, usage } = result;
  await commands.liveSave(`${label}/${brief.id}-r${rep}-${phase}.svg`, asset.svg);
  return {
    ...base,
    svgChars: asset.svg.length,
    title: asset.title,
    inputTokens: usage.inputTokens ?? undefined,
    outputTokens: usage.outputTokens ?? undefined,
    reasoningTokens: usage.reasoningTokens ?? undefined,
    evaluation: await evaluateSvg(asset.svg, brief.w, brief.h),
  };
}

/** The first drawing of one brief: saved by an earlier run (re-evaluated, no provider call) or newly generated. */
async function firstDrawing(
  brief: (typeof kBriefs)[number],
  rep: number,
  prompt: string
): Promise<{ first: LiveRecord; svg?: string } | null> {
  const name = `${brief.id}-r${rep}-first`;
  if (!from) {
    const result = await generate(prompt, brief.w, brief.h, `${label}:${brief.id}:${rep}`);
    return { first: await record(brief, rep, 'first', result), svg: 'error' in result ? undefined : result.asset.svg };
  }
  const saved = await commands.liveRead(`${from}/${name}.json`);
  if (!saved) return null;
  const first: LiveRecord = { ...(JSON.parse(saved) as LiveRecord), label };
  const svg = (await commands.liveRead(`${from}/${name}.svg`)) ?? undefined;
  if (svg) {
    first.evaluation = await evaluateSvg(svg, brief.w, brief.h);
    await commands.liveSave(`${label}/${name}.svg`, svg);
  }
  return { first, svg };
}

async function pool<T>(items: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await items[i]!();
      }
    })
  );
  return out;
}

describe.runIf(enabled)('live carving generation', () => {
  it(`runs ${label} ${model}`, async () => {
    const jobs = kBriefs
      .filter(brief => !only || only.includes(brief.id))
      .flatMap(brief =>
        Array.from({ length: reps }, (_, rep) => async (): Promise<LiveRecord[]> => {
          const prompt = variantBrief(brief.prompt, 'line', rep, 4);
          const drawn = await firstDrawing(brief, rep, prompt);
          if (!drawn) return [];
          const { first, svg } = drawn;
          await commands.liveSave(`${label}/${brief.id}-r${rep}-first.json`, JSON.stringify(first, null, 1));
          if (!repair || first.evaluation?.accepted) return [first];
          // One repair turn with the local findings through the app's revise path; a failed generation is retried plainly.
          const result = await generate(
            repairBrief(prompt, first),
            brief.w,
            brief.h,
            `${label}:${brief.id}:${rep}:repair`,
            svg ? { id: 'previous', svg, prompt } : undefined
          );
          const repaired = await record(brief, rep, 'repair', result);
          await commands.liveSave(`${label}/${brief.id}-r${rep}-repair.json`, JSON.stringify(repaired, null, 1));
          return [first, repaired];
        })
      );
    const records = (await pool(jobs, concurrency)).flat();
    await commands.liveSave(`${label}/records.json`, JSON.stringify(records, null, 1));
    const { spentUsd } = await commands.liveSpent();
    console.log(`[carve-live] ${label}: ${records.length} records, ledger spend $${spentUsd.toFixed(4)}`);
    expect(records.length).toBeGreaterThan(0);
  });
});
