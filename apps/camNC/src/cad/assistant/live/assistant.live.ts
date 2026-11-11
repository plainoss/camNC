/**
 * Live provider benchmark of the production assistant loop with the real sandboxed check.
 * Opt in: ASSISTANT_LIVE=1 pnpm vitest run --config vitest.assistant-live.config.ts (from apps/camNC).
 * Env: ASSISTANT_VARIANT (label), ASSISTANT_LIVE_MODEL (gpt-5.4-mini | gemini-3.5-flash), ASSISTANT_LIVE_REPS,
 * ASSISTANT_LIVE_TASKS, ASSISTANT_LIVE_OUT, ASSISTANT_LIVE_BUDGET (USD, all runs sharing the ledger).
 */
import { commands } from '@vitest/browser/context';
import { describe, expect, it } from 'vitest';
import cupboardExample from '../../../../../../packages/cad-script/examples/cupboard.cad.ts?raw';
import plateExample from '../../../../../../packages/cad-script/examples/plate.cad.ts?raw';
import trayExample from '../../../../../../packages/cad-script/examples/tray.cad.ts?raw';
import shelfExample from '../../../../../../packages/cad-script/examples/shelf-side.cad.ts?raw';
import pebbleExample from '../../../../../../packages/cad-script/examples/pebble-tray.cad.ts?raw';
import { runLiveTask, type LiveRun } from './liveRun';
import { requestAssistant, type ProviderConfig } from '../provider';
import { liveStart, liveTask, liveTaskIds } from './liveTasks';

type LiveCommands = {
  liveProviderFetch(url: string, init: { headers: Record<string, string>; body: string }): Promise<{ status: number; body: string }>;
  liveSpend(): Promise<{ usd: number; budget: number }>;
  liveRecord(name: string, json: string): Promise<void>;
};
const live = commands as unknown as LiveCommands;
declare const __ASSISTANT_LIVE__: Record<string, string | undefined> | undefined;
const env = typeof __ASSISTANT_LIVE__ === 'undefined' ? {} : __ASSISTANT_LIVE__;
const enabled = env.ASSISTANT_LIVE === '1';

const examples = { cupboard: cupboardExample, plate: plateExample, tray: trayExample, 'shelf-side': shelfExample, 'pebble-tray': pebbleExample };
const model = env.ASSISTANT_LIVE_MODEL ?? 'gpt-5.4-mini';
const config: ProviderConfig = model.startsWith('gemini')
  ? { kind: 'compatible', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', model, protocol: 'chat', tools: true, images: false }
  : { kind: 'compatible', endpoint: 'https://api.openai.com/v1', model, protocol: 'responses', tools: true, images: false };
const pricing = model.startsWith('gemini')
  ? { inputUsdPerMillion: 1.5, outputUsdPerMillion: 9, cacheReadUsdPerMillion: 0.15 }
  : { inputUsdPerMillion: 0.75, outputUsdPerMillion: 4.5, cacheReadUsdPerMillion: 0.075 };
const variant = env.ASSISTANT_VARIANT ?? 'baseline';
const reps = Number(env.ASSISTANT_LIVE_REPS ?? 3);
const replies = Number(env.ASSISTANT_LIVE_REPLIES ?? 2);

const fetcher: typeof fetch = async (input, init) => {
  const headers = Object.fromEntries(new Headers(init?.headers).entries());
  delete headers.authorization;
  const { status, body } = await live.liveProviderFetch(String(input), { headers, body: String(init?.body) });
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
};

const runs = liveTaskIds.flatMap(id => Array.from({ length: reps }, (_, rep) => ({ id, rep })));

describe.runIf(enabled).concurrent(`live assistant ${variant} ${model}`, () => {
  it.each(runs)('$id #$rep', async ({ id, rep }) => {
    const spend = await live.liveSpend();
    if (spend.usd >= spend.budget) {
      console.warn(`budget reached (${spend.usd.toFixed(3)} USD); skipping ${id}#${rep}`);
      return;
    }
    const task = liveTask(id);
    const start = liveStart(task);
    const started = performance.now();
    let error: string | undefined;
    let run: LiveRun | undefined;
    try {
      run = await runLiveTask(task, start, {
        config,
        key: 'server-injected',
        signal: new AbortController().signal,
        examples,
        pricing,
        // Gemini's compatible endpoint reports no cache breakdown, so the loop prices it as unknown; the Node ledger still caps spend.
        limits: { maxRunMs: 420_000, maxRequestMs: 150_000, ...(!model.startsWith('gemini') && { maxCostUsd: 0.5 }) },
        request: request => requestAssistant(request, fetcher),
        replies,
      });
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    const results = run?.results ?? [];
    const last = results.at(-1);
    const sum = (key: 'calls' | 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'reasoningTokens' | 'costUsd' | 'reusedChecks') =>
      results.reduce((total, result) => total + (result.usage[key] ?? 0), 0);
    const finalText = last?.messages.at(-1)?.text ?? '';
    const latencies = run?.messages.flatMap(m => (m.role === 'assistant' && m.latencyMs ? [m.latencyMs] : [])) ?? [];
    const record = {
      variant,
      model,
      task: id,
      rep,
      status: last?.status ?? 'error',
      error,
      stopReason: last?.stopReason,
      questions: run?.questions ?? 0,
      proposal: !!last?.proposal,
      success: !!run?.assessment?.automaticPass,
      assessment: run?.assessment?.checks,
      requests: sum('calls'),
      checks: results.reduce((total, result) => total + result.checks, 0),
      reusedChecks: sum('reusedChecks'),
      scriptErrors: run?.scriptErrors ?? 0,
      failedChecks: run?.failedChecks ?? 0,
      inputTokens: sum('inputTokens'),
      outputTokens: sum('outputTokens'),
      cachedTokens: sum('cacheReadTokens'),
      reasoningTokens: sum('reasoningTokens'),
      costUsd: sum('costUsd'),
      latencyMs: performance.now() - started,
      providerMs: latencies.reduce((a, b) => a + b, 0),
      mentionsStability: /tip|topple|anchor|wall|stabil|wobbl|slender|rack|brace/i.test(finalText),
      finalText,
      transcript: run?.messages.map(({ responseItems: _items, anthropicContent: _content, images: _images, ...message }) => message),
    };
    await live.liveRecord(`${variant}-${model}-${id}-${rep}.json`, JSON.stringify(record, null, 2));
    expect(record.status).not.toBe('error');
  });
});
