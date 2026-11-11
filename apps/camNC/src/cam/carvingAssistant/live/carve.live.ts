import { commands } from '@vitest/browser/context';
import { describe, expect, it } from 'vitest';
import type { ProviderConfig } from '@/cad/assistant/provider';
import { requestAssistant } from '@/cad/assistant/provider';
import { generateCarvingAsset, type CarvingGenerationOptions } from '../generation';
import { variantBrief } from '../session';
import { evaluateSvg, kDetail, kMinFeature, type Evaluation } from './evaluate';
import { repairBrief } from './repair';

declare module '@vitest/browser/context' {
  interface BrowserCommands {
    carveProviderFetch(request: { url: string; body: string; extra?: Record<string, unknown>; tag?: string }): Promise<{
      status: number;
      body: unknown;
      costUsd?: number;
    }>;
    carveSave(relative: string, content: string): Promise<void>;
    carveRead(relative: string): Promise<string | null>;
    carveList(relative: string): Promise<string[]>;
    carveSpent(): Promise<number>;
    carveEnv(): Promise<Record<string, string>>;
  }
}

/** Fixed prompt set: subject, size (mm) and a stable id. Default detail (balanced), line style, as the app sends them. */
export const kBriefs = [
  { id: 'owl', w: 80, h: 80, prompt: 'A charming owl perched on a branch, big round eyes, folded wings.' },
  { id: 'mouse-ball', w: 150, h: 150, prompt: 'A cute mouse playing with a ball: rounded ears, curious face, paws reaching for the ball, curved tail.' },
  { id: 'plaque', w: 150, h: 60, prompt: 'A name plaque reading "EMMA" in bold letters with a small star on each side.' },
  { id: 'tree', w: 150, h: 150, prompt: 'A detailed oak tree with a strong trunk, spreading branches and leafy crown.' },
  { id: 'cat', w: 80, h: 80, prompt: 'A sitting cat silhouette seen from the side, tail curled around its paws.' },
  { id: 'celtic-knot', w: 80, h: 80, prompt: 'A square celtic knot with interlaced over-under bands.' },
  { id: 'fish', w: 150, h: 150, prompt: 'A fish with scales, fins and an eye, swimming among a few bubbles.' },
  { id: 'mountains', w: 150, h: 80, prompt: 'A mountain landscape: three peaks with snow caps, a sun and a few pine trees in front.' },
];

// CARVE_* settings come from the node process; only those names are passed to the page (never keys).
const env: Record<string, string | undefined> = await commands.carveEnv();
const live = env.CARVE_LIVE === '1';
const label = env.CARVE_VARIANT ?? 'baseline';
const provider = env.CARVE_PROVIDER ?? 'openai';
const model = env.CARVE_MODEL ?? (provider === 'gemini' ? 'gemini-3.5-flash' : 'gpt-5.4-mini');
const runs = Number(env.CARVE_RUNS ?? 2);
const toolAware = env.CARVE_TOOL_AWARE === '1';
const repairFrom = env.CARVE_REPAIR_FROM ?? env.CARVE_REEVAL_FROM;
const reevalOnly = !!env.CARVE_REEVAL_FROM;
const effort = env.CARVE_EFFORT;
const maxOutputTokens = env.CARVE_MAX_OUT ? Number(env.CARVE_MAX_OUT) : undefined;
const concurrency = Number(env.CARVE_CONCURRENCY ?? 4);
const only = env.CARVE_BRIEFS?.split(',');

const config: ProviderConfig =
  provider === 'gemini'
    ? { kind: 'compatible', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', model, protocol: 'chat', tools: true, images: false }
    : { kind: 'compatible', endpoint: 'https://api.openai.com/v1', model, protocol: 'responses', tools: true, images: false };
// The page never sees a key: the node command adds it. This placeholder only satisfies the request shape.
const credentials = { config, key: 'server-side-key' };

export interface LiveRecord {
  variant: string;
  model: string;
  briefId: string;
  run: number;
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

async function generate(prompt: string, w: number, h: number, tag: string, previous?: { id: string; svg: string; prompt: string }) {
  let costUsd = 0;
  const request: typeof requestAssistant = req =>
    requestAssistant(req, async (url, init) => {
      const result = await commands.carveProviderFetch({
        url: String(url),
        body: String(init?.body),
        tag,
        extra: { ...(effort && (provider === 'gemini' ? { reasoning_effort: effort } : { reasoning: { effort } })) },
      });
      costUsd += result.costUsd ?? 0;
      return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'content-type': 'application/json' } });
    });
  const options = {
    prompt,
    constraints: { widthMm: w, heightMm: h, detail: kDetail, minFeatureMm: kMinFeature },
    credentials,
    signal: AbortSignal.timeout(200_000),
    limits: { maxRequestMs: 180_000, ...(maxOutputTokens && { maxOutputTokens }), maxInputCharacters: 120_000 },
    request,
    ...(previous && { previous }),
    // Variant A: the edit in generation.ts reads this; without it the field is ignored.
    ...(toolAware && { tool: { angleDeg: 60, diameterMm: 6, maxDepthMm: 3 } }),
  } as CarvingGenerationOptions;
  const started = performance.now();
  try {
    const { asset, usage } = await generateCarvingAsset(options);
    return { asset, usage, costUsd, latencyMs: performance.now() - started };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), costUsd, latencyMs: performance.now() - started };
  }
}

async function record(
  briefId: string,
  run: number,
  phase: LiveRecord['phase'],
  w: number,
  h: number,
  result: Awaited<ReturnType<typeof generate>>
): Promise<LiveRecord> {
  const base: LiveRecord = { variant: label, model, briefId, run, phase, widthMm: w, heightMm: h, costUsd: result.costUsd, latencyMs: result.latencyMs };
  if ('error' in result) return { ...base, generationError: result.error };
  const { asset, usage } = result;
  const evaluation = await evaluateSvg(asset.svg, w, h);
  const name = `${label}/${briefId}-r${run}-${phase}`;
  await commands.carveSave(`${name}.svg`, asset.svg);
  return {
    ...base,
    svgChars: asset.svg.length,
    title: asset.title,
    inputTokens: usage.inputTokens ?? undefined,
    outputTokens: usage.outputTokens ?? undefined,
    reasoningTokens: usage.reasoningTokens ?? undefined,
    evaluation,
  };
}

async function pool<T>(items: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await items[i]();
      }
    })
  );
  return out;
}

describe.skipIf(!live)('live carving generation', () => {
  it(`runs ${label}`, async () => {
    const briefs = kBriefs.filter(b => !only || only.includes(b.id));
    const jobs: (() => Promise<LiveRecord[]>)[] = [];
    for (const brief of briefs)
      for (let run = 0; run < runs; run++)
        jobs.push(async () => {
          const prompt = variantBrief(brief.prompt, 'line', run, 4);
          const tag = `${label}:${brief.id}:${run}`;
          let first: LiveRecord;
          let firstSvg: string | undefined;
          if (repairFrom) {
            const saved = await commands.carveRead(`${repairFrom}/${brief.id}-r${run}-first.json`);
            if (!saved) return [];
            first = { ...(JSON.parse(saved) as LiveRecord), variant: label };
            firstSvg = (await commands.carveRead(`${repairFrom}/${brief.id}-r${run}-first.svg`)) ?? undefined;
            // Re-check the saved source with the current code (e.g. a changed sanitizer); no provider call.
            if (firstSvg) first.evaluation = await evaluateSvg(firstSvg, brief.w, brief.h);
            if (firstSvg) await commands.carveSave(`${label}/${brief.id}-r${run}-first.svg`, firstSvg);
            await commands.carveSave(`${label}/${brief.id}-r${run}-first.json`, JSON.stringify(first, null, 1));
            if (reevalOnly) return [first];
          } else {
            first = await record(brief.id, run, 'first', brief.w, brief.h, await generate(prompt, brief.w, brief.h, tag));
            await commands.carveSave(`${label}/${brief.id}-r${run}-first.json`, JSON.stringify(first, null, 1));
          }
          const strict = env.CARVE_REPAIR_STRICT === '1';
          const e = first.evaluation;
          // Strict: also repair accepted drawings above (my) thresholds of 3 mm² narrow land or 5 mm² removed cut area.
          const needsRepair = !e?.accepted || (strict && ((e.narrowLandAreaMm2 ?? 0) > 3 || (e.removedCutAreaMm2 ?? 0) > 5));
          if (!repairFrom || !needsRepair) return [first];
          // One repair turn with machine-readable findings; a failed generation is retried plainly.
          const text = repairBrief(prompt, first);
          const result = await generate(text, brief.w, brief.h, `${tag}:repair`, firstSvg ? { id: 'previous', svg: firstSvg, prompt } : undefined);
          const repaired = await record(brief.id, run, 'repair', brief.w, brief.h, result);
          await commands.carveSave(`${label}/${brief.id}-r${run}-repair.json`, JSON.stringify(repaired, null, 1));
          return [first, repaired];
        });
    const records = (await pool(jobs, concurrency)).flat();
    await commands.carveSave(`${label}/records.json`, JSON.stringify(records, null, 1));
    console.log(`[carve-live] ${label}: ${records.length} records, ledger spend $${(await commands.carveSpent()).toFixed(4)}`);
    expect(records.length).toBeGreaterThan(0);
  });
});
