import fs from 'node:fs';
import path from 'node:path';
import type { BrowserCommand } from 'vitest/node';

/**
 * Node-side commands for the opt-in live carving harness. Provider keys come from the environment and are added
 * here, so they never enter the test page. Every call is priced from its reported usage into a ledger, and a call
 * that could take the ledger past CARVE_BUDGET_USD is refused before it is sent.
 */
export const kCarveOut =
  process.env.CARVE_OUT ??
  '/private/tmp/claude-501/-Users-manu-development-w69b-cnc-present-toolpath--claude-worktrees-nostalgic-yonath-37b1cb/db7c3c7c-5977-456b-9e85-96d8cd06d2d0/scratchpad/carve';
const kBudgetUsd = Number(process.env.CARVE_BUDGET_USD ?? 2);
/** Worst-case price of one in-flight call, held until its usage is known. */
const kReserveUsd = Number(process.env.CARVE_RESERVE_USD ?? 0.08);

/** USD per million tokens. gpt-5.4-mini: published list price. Gemini: conservative estimate (assumed, not looked up). */
export const kPrices: Record<string, { input: number; cached: number; output: number }> = {
  'gpt-5.4-mini': { input: 0.75, cached: 0.075, output: 4.5 },
  'gemini-3.5-flash': { input: 1.0, cached: 0.25, output: 6.0 },
};
const hosts: Record<string, string> = {
  'api.openai.com': 'OPENAI_API_KEY',
  'generativelanguage.googleapis.com': 'GEMINI_API_KEY',
};

const ledgerFile = path.join(kCarveOut, 'ledger.json');
type Ledger = { spentUsd: number; calls: { at: string; model: string; tag?: string; status?: number; costUsd: number; usage: unknown; error?: string }[] };
const readLedger = (): Ledger => {
  try {
    return JSON.parse(fs.readFileSync(ledgerFile, 'utf8')) as Ledger;
  } catch {
    return { spentUsd: 0, calls: [] };
  }
};
let pending = 0;

export function costOf(model: string, usage: Record<string, any> | undefined): number {
  const price = kPrices[model] ?? { input: 2, cached: 2, output: 12 };
  if (!usage) return kReserveUsd;
  const input = usage.input_tokens ?? usage.prompt_tokens ?? 0;
  const cached = (usage.input_tokens_details ?? usage.prompt_tokens_details)?.cached_tokens ?? 0;
  // Gemini's compatible endpoint leaves thinking out of completion_tokens but bills it: count the total's remainder.
  const output = Math.max(usage.output_tokens ?? usage.completion_tokens ?? 0, (usage.total_tokens ?? 0) - input);
  return ((input - cached) * price.input + cached * price.cached + output * price.output) / 1e6;
}

const providerFetch: BrowserCommand<[{ url: string; body: string; extra?: Record<string, unknown>; tag?: string }]> = async (
  _context,
  { url, body, extra, tag }
) => {
  const target = new URL(url);
  const env = hosts[target.hostname];
  if (target.protocol !== 'https:' || !env) return { status: 400, body: { error: `host ${target.hostname} not allowed` } };
  const key = process.env[env];
  if (!key) return { status: 401, body: { error: `${env} not set` } };
  const ledger = readLedger();
  if (ledger.spentUsd + pending + kReserveUsd > kBudgetUsd)
    return { status: 402, body: { error: `budget: spent ${ledger.spentUsd.toFixed(4)} of ${kBudgetUsd}` } };
  pending += kReserveUsd;
  const payload = { ...(JSON.parse(body) as Record<string, unknown>), ...extra };
  const model = String(payload.model);
  let status = 0,
    json: Record<string, any> = {};
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(170_000),
    });
    status = response.status;
    json = (await response.json().catch(() => ({}))) as Record<string, any>;
  } catch (error) {
    status = 599;
    json = { error: String(error) };
  } finally {
    pending -= kReserveUsd;
  }
  // A timed-out or failed call may still be billed: book the reservation when no usage came back from a sent call.
  const costUsd = status === 200 ? costOf(model, json.usage) : status >= 500 ? kReserveUsd : 0;
  const after = readLedger();
  after.spentUsd += costUsd;
  after.calls.push({
    at: new Date().toISOString(),
    model,
    tag,
    status,
    costUsd,
    usage: json.usage ?? null,
    ...(status !== 200 && { error: String(json.error?.message ?? json.error ?? '').slice(0, 300) }),
  });
  fs.mkdirSync(kCarveOut, { recursive: true });
  fs.writeFileSync(ledgerFile, JSON.stringify(after, null, 1));
  // Error bodies are reduced to their message: never echo request data back.
  const out = status === 200 ? json : { error: String(json.error?.message ?? json.error ?? 'error').slice(0, 300) };
  return { status, body: out, costUsd };
};

const inside = (relative: string) => {
  const file = path.resolve(kCarveOut, relative);
  if (!file.startsWith(path.resolve(kCarveOut) + path.sep)) throw new Error('outside the output directory');
  return file;
};
const saveFile: BrowserCommand<[string, string]> = async (_context, relative, content) => {
  const file = inside(relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
const readFile: BrowserCommand<[string]> = async (_context, relative) => {
  try {
    return fs.readFileSync(inside(relative), 'utf8');
  } catch {
    return null;
  }
};
const listFiles: BrowserCommand<[string]> = async (_context, relative) => {
  try {
    return fs.readdirSync(inside(relative));
  } catch {
    return [];
  }
};
const spent: BrowserCommand<[]> = async () => readLedger().spentUsd;
const carveEnv: BrowserCommand<[]> = async () =>
  Object.fromEntries(Object.entries(process.env).filter(([name]) => /^CARVE_[A-Z_]+$/.test(name) && !/KEY|TOKEN|SECRET/.test(name)));

export const carveLiveCommands = { carveProviderFetch: providerFetch, carveSave: saveFile, carveRead: readFile, carveList: listFiles, carveSpent: spent, carveEnv };
