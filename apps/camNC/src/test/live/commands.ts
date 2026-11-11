/**
 * Node-side Vitest browser commands shared by the opt-in live assistant harnesses (see README.md).
 *
 * Provider keys never enter the test page: the page sends requests with a placeholder key, and liveProviderFetch
 * drops every page header and adds the real key from OPENAI_API_KEY / GEMINI_API_KEY here, in the Node process.
 * Every call is priced from its reported usage into a ledger in the output directory, and a call that could take
 * the ledger past the budget is refused before it is sent.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserCommand } from 'vitest/node';
import { livePrice } from './prices';

export interface LiveFetchRequest {
  url: string;
  /** The JSON request body the app built. */
  body: string;
  /** Extra top-level payload fields, such as a reasoning effort. */
  extra?: Record<string, unknown>;
  /** Free-form label stored with the ledger entry. */
  tag?: string;
}
export interface LiveFetchResponse {
  status: number;
  body: unknown;
  costUsd: number;
}
export interface LiveSpend {
  spentUsd: number;
  budgetUsd: number;
}
export interface LiveCommandOptions {
  outDir: string;
  budgetUsd: number;
  /** Worst-case price of one in-flight call, held against the budget until its usage is known. */
  reserveUsd: number;
}

const kKeyEnv: Record<string, string> = {
  'api.openai.com': 'OPENAI_API_KEY',
  'generativelanguage.googleapis.com': 'GEMINI_API_KEY',
};

interface LedgerCall {
  at: string;
  model: string;
  tag?: string;
  status: number;
  costUsd: number;
  usage: unknown;
  error?: string;
}
interface Ledger {
  spentUsd: number;
  calls: LedgerCall[];
}

type Usage = Record<string, unknown> & {
  input_tokens_details?: { cached_tokens?: number };
  prompt_tokens_details?: { cached_tokens?: number };
};

export function liveCostUsd(model: string, usage: Usage): number {
  const price = livePrice(model);
  const n = (value: unknown) => (typeof value === 'number' ? value : 0);
  const input = n(usage.input_tokens ?? usage.prompt_tokens);
  const cached = n((usage.input_tokens_details ?? usage.prompt_tokens_details)?.cached_tokens);
  // Gemini's compatible endpoint leaves thinking out of completion_tokens but bills it: count the total's remainder.
  const output = Math.max(n(usage.output_tokens ?? usage.completion_tokens), n(usage.total_tokens) - input);
  return ((input - cached) * price.input + cached * price.cached + output * price.output) / 1e6;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const errorText = (json: Record<string, unknown>) => {
  const error = json.error as { message?: unknown } | string | undefined;
  return String((typeof error === 'object' ? error?.message : error) ?? 'error').slice(0, 300);
};

export function liveCommands({ outDir, budgetUsd, reserveUsd }: LiveCommandOptions) {
  const ledgerFile = path.join(outDir, 'ledger.json');
  let pending = 0;
  const readLedger = (): Ledger => {
    try {
      return JSON.parse(fs.readFileSync(ledgerFile, 'utf8')) as Ledger;
    } catch {
      return { spentUsd: 0, calls: [] };
    }
  };
  // Synchronous read-modify-write: concurrent calls in this process cannot interleave inside it.
  const book = (call: LedgerCall) => {
    const ledger = readLedger();
    ledger.spentUsd += call.costUsd;
    ledger.calls.push(call);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 1));
  };
  const inside = (relative: string) => {
    const file = path.resolve(outDir, relative);
    if (!file.startsWith(path.resolve(outDir) + path.sep)) throw new Error('outside the output directory');
    return file;
  };

  const liveProviderFetch: BrowserCommand<[LiveFetchRequest]> = async (_context, { url, body, extra, tag }): Promise<LiveFetchResponse> => {
    const target = new URL(url);
    const keyEnv = kKeyEnv[target.hostname];
    if (target.protocol !== 'https:' || !keyEnv) return { status: 400, body: { error: `host ${target.hostname} not allowed` }, costUsd: 0 };
    const key = process.env[keyEnv];
    if (!key) return { status: 401, body: { error: `${keyEnv} not set` }, costUsd: 0 };
    const payload = { ...(JSON.parse(body) as Record<string, unknown>), ...extra };
    const model = String(payload.model);
    let status = 0;
    let json: Record<string, unknown> = {};
    let costUsd = 0;
    // Retries transient failures (429, 5xx, network) with backoff; every attempt passes the budget check.
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt) await sleep(2000 * 2 ** (attempt - 1));
      const spentUsd = readLedger().spentUsd;
      if (spentUsd + pending + reserveUsd > budgetUsd)
        return { status: 402, body: { error: `live budget: spent ${spentUsd.toFixed(4)} of ${budgetUsd} USD` }, costUsd };
      pending += reserveUsd;
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(170_000),
        });
        status = response.status;
        json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      } catch (error) {
        status = 599;
        json = { error: String(error) };
      } finally {
        pending -= reserveUsd;
      }
      // A call that timed out or dropped may still be billed: book the reservation when no response came back.
      const cost =
        status === 200 && json.usage ? liveCostUsd(model, json.usage as Usage) : status === 200 || status === 599 ? reserveUsd : 0;
      costUsd += cost;
      // Error bodies are reduced to their message: never store or echo request data.
      book({
        at: new Date().toISOString(),
        model,
        tag,
        status,
        costUsd: cost,
        usage: json.usage ?? null,
        ...(status !== 200 && { error: errorText(json) }),
      });
      if (status !== 429 && status < 500) break;
    }
    return { status, body: status === 200 ? json : { error: errorText(json) }, costUsd };
  };
  const liveSave: BrowserCommand<[string, string]> = async (_context, relative, content) => {
    const file = inside(relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  const liveRead: BrowserCommand<[string]> = async (_context, relative) => {
    try {
      return fs.readFileSync(inside(relative), 'utf8');
    } catch {
      return null;
    }
  };
  const liveSpent: BrowserCommand<[]> = async (): Promise<LiveSpend> => ({ spentUsd: readLedger().spentUsd, budgetUsd });
  return { liveProviderFetch, liveSave, liveRead, liveSpent };
}
