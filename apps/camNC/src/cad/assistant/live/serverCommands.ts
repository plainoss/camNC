/**
 * Node-side Vitest browser commands for the opt-in live assistant harness.
 * Provider keys stay in this process: the page sends a placeholder bearer token, and the command swaps in the key from env.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** USD per million tokens. gpt-5.4-mini from the OpenAI model page (2026-11); gemini-3.5-flash from third-party trackers (2026). */
export const livePrices: Record<string, { input: number; cached: number; output: number }> = {
  'gpt-5.4-mini': { input: 0.75, cached: 0.075, output: 4.5 },
  'gemini-3.5-flash': { input: 1.5, cached: 0.15, output: 9.0 },
};

const outDir = () => process.env.ASSISTANT_LIVE_OUT ?? path.resolve('assistant-live-results');
const ledgerPath = () => path.join(outDir(), 'spend.json');
const budget = () => Number(process.env.ASSISTANT_LIVE_BUDGET ?? '4');

interface Ledger {
  usd: number;
  calls: number;
  byModel: Record<string, { usd: number; calls: number; input: number; cached: number; output: number }>;
}
function readLedger(): Ledger {
  try {
    return JSON.parse(readFileSync(ledgerPath(), 'utf8')) as Ledger;
  } catch {
    return { usd: 0, calls: 0, byModel: {} };
  }
}

function keyFor(url: string): string {
  const host = new URL(url).hostname;
  const key =
    host === 'api.openai.com'
      ? process.env.OPENAI_API_KEY
      : host === 'generativelanguage.googleapis.com'
        ? process.env.GEMINI_API_KEY
        : undefined;
  if (!key) throw new Error(`No key in env for ${host}.`);
  return key;
}

function usageOf(body: unknown): { input: number; cached: number; output: number } {
  const usage = (body as { usage?: Record<string, unknown> })?.usage ?? {};
  const details = (usage.input_tokens_details ?? usage.prompt_tokens_details ?? {}) as Record<string, unknown>;
  const n = (value: unknown) => (typeof value === 'number' ? value : 0);
  return {
    input: n(usage.input_tokens ?? usage.prompt_tokens),
    cached: n(details.cached_tokens),
    // Some compatible endpoints leave thinking out of completion_tokens; bill whatever the total says was generated.
    output: Math.max(n(usage.output_tokens ?? usage.completion_tokens), n(usage.total_tokens) - n(usage.input_tokens ?? usage.prompt_tokens)),
  };
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const liveCommands = {
  async liveProviderFetch(_context: unknown, url: string, init: { headers: Record<string, string>; body: string }) {
    mkdirSync(outDir(), { recursive: true });
    if (readLedger().usd >= budget()) return { status: 599, body: JSON.stringify({ error: 'live budget reached' }) };
    const headers = { ...init.headers, authorization: `Bearer ${keyFor(url)}` };
    // Harness-level retry for transient provider failures; applied identically to every variant.
    let response: Response | undefined;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        response = await fetch(url, { method: 'POST', headers, body: init.body, signal: AbortSignal.timeout(150_000) });
      } catch {
        response = undefined;
      }
      if (response && response.status !== 429 && response.status < 500) break;
      await sleep(2000 * 2 ** attempt);
    }
    if (!response) return { status: 598, body: '{"error":"network"}' };
    const text = await response.text();
    if (response.ok) {
      const model = String(JSON.parse(init.body).model);
      const price = livePrices[model] ?? { input: 2, cached: 2, output: 10 };
      const used = usageOf(JSON.parse(text));
      const usd = ((used.input - used.cached) * price.input + used.cached * price.cached + used.output * price.output) / 1e6;
      const ledger = readLedger();
      ledger.usd += usd;
      ledger.calls++;
      const row = (ledger.byModel[model] ??= { usd: 0, calls: 0, input: 0, cached: 0, output: 0 });
      row.usd += usd;
      row.calls++;
      row.input += used.input;
      row.cached += used.cached;
      row.output += used.output;
      writeFileSync(ledgerPath(), JSON.stringify(ledger, null, 2));
    } else {
      // Error bodies can echo request details; keep only the status and a short excerpt locally.
      appendFileSync(path.join(outDir(), 'errors.log'), `${new Date().toISOString()} ${response.status} ${text.slice(0, 400)}\n`);
    }
    return { status: response.status, body: text };
  },
  async liveSpend() {
    return { ...readLedger(), budget: budget() };
  },
  async liveRecord(_context: unknown, name: string, json: string) {
    mkdirSync(outDir(), { recursive: true });
    writeFileSync(path.join(outDir(), name), json);
  },
};
