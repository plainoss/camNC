/**
 * Live provider runs of the production design assistant loop with the real sandboxed check.
 * Opt in from apps/camNC: ASSISTANT_LIVE=1 pnpm vitest run --config live-assistant.vitest.config.ts
 * Settings and output: src/test/live/README.md.
 */
import { commands } from '@vitest/browser/context';
import { describe, expect, it } from 'vitest';
import cupboardExample from '../../../../../../packages/cad-script/examples/cupboard.cad.ts?raw';
import pebbleExample from '../../../../../../packages/cad-script/examples/pebble-tray.cad.ts?raw';
import plateExample from '../../../../../../packages/cad-script/examples/plate.cad.ts?raw';
import shelfExample from '../../../../../../packages/cad-script/examples/shelf-side.cad.ts?raw';
import trayExample from '../../../../../../packages/cad-script/examples/tray.cad.ts?raw';
import { kLivePlaceholderKey, liveEnv, liveFetch, liveProvider } from '@/test/live/page';
import { requestAssistant } from '../provider';
import { runLiveTask, type LiveRun } from './liveRun';
import { liveStart, liveTask, liveTaskIds } from './liveTasks';

const enabled = liveEnv.ASSISTANT_LIVE === '1';
const examples = {
  cupboard: cupboardExample,
  plate: plateExample,
  tray: trayExample,
  'shelf-side': shelfExample,
  'pebble-tray': pebbleExample,
};
const model = liveEnv.ASSISTANT_LIVE_MODEL ?? 'gpt-5.4-mini';
const { config, pricing } = liveProvider(model);
const label = liveEnv.ASSISTANT_LIVE_LABEL ?? 'run';
const reps = Number(liveEnv.ASSISTANT_LIVE_REPS ?? 3);
const replies = Number(liveEnv.ASSISTANT_LIVE_REPLIES ?? 2);
const runs = liveTaskIds(liveEnv.ASSISTANT_LIVE_TASKS).flatMap(id => Array.from({ length: reps }, (_, rep) => ({ id, rep })));

describe.runIf(enabled).concurrent(`live assistant ${label} ${model}`, () => {
  it.each(runs)('$id #$rep', async ({ id, rep }) => {
    const spend = await commands.liveSpent();
    if (spend.spentUsd >= spend.budgetUsd) {
      console.warn(`budget reached (${spend.spentUsd.toFixed(3)} USD); skipping ${id}#${rep}`);
      return;
    }
    const task = liveTask(id);
    const start = liveStart(task);
    const started = performance.now();
    const fetcher = liveFetch({ tag: `${label}:${id}:${rep}` });
    let error: string | undefined;
    let run: LiveRun | undefined;
    try {
      run = await runLiveTask(task, start, {
        config,
        key: kLivePlaceholderKey,
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
      label,
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
    await commands.liveSave(`${label}/${model}-${id}-${rep}.json`, JSON.stringify(record, null, 2));
    expect(record.status).not.toBe('error');
  });
});
