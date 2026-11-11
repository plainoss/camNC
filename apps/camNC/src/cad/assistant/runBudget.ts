import type { AssistantMessage } from './provider';

export interface AssistantLimits {
  maxInputCharacters?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxTotalTokens?: number;
  maxCostUsd?: number;
  maxRequestMs?: number;
  maxRunMs?: number;
  maxImages?: number;
  maxImageBytes?: number;
}
export interface AssistantPricing {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cacheReadUsdPerMillion?: number;
  cacheWriteUsdPerMillion?: number;
  cacheWritesAtInputPrice?: boolean;
}
export interface AssistantRunUsage {
  calls: number;
  checks: number;
  reusedChecks: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  costUsd: number | null;
}
const tokenKeys = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const;
export function createAssistantUsage(): AssistantRunUsage {
  return {
    calls: 0,
    checks: 0,
    reusedChecks: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    costUsd: 0,
  };
}
export function validateAssistantBudget(limits: AssistantLimits, pricing?: AssistantPricing) {
  for (const [key, value] of Object.entries(limits)) {
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value <= 0 || (key !== 'maxCostUsd' && !Number.isSafeInteger(value)))
      throw new Error('Assistant budgets must be positive finite numbers; counts and durations must be integers.');
  }
  if (pricing) {
    for (const key of ['inputUsdPerMillion', 'outputUsdPerMillion'] as const)
      if (!Number.isFinite(pricing[key]) || pricing[key] < 0)
        throw new Error('Enter both input and output prices as non-negative finite numbers.');
    for (const [key, value] of Object.entries(pricing)) {
      if (key === 'cacheWritesAtInputPrice') {
        if (typeof value !== 'boolean') throw new Error('Choose whether cache writes use the input price.');
        continue;
      }
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0))
        throw new Error('Assistant prices must be non-negative finite numbers.');
    }
  }
  if (limits.maxCostUsd !== undefined && !pricing) throw new Error('Enter model pricing before setting a dollar budget.');
}
export function recordAssistantUsage(total: AssistantRunUsage, message: AssistantMessage, pricing?: AssistantPricing) {
  total.calls++;
  for (const key of tokenKeys) {
    const value = message.usage?.[key];
    total[key] = total[key] !== null && typeof value === 'number' && Number.isFinite(value) && value >= 0 ? total[key] + value : null;
  }
  const usage = message.usage;
  let cost: number | null = null;
  if (pricing && usage?.inputTokens !== undefined && usage.outputTokens !== undefined) {
    const read = usage.cacheReadTokens;
    // When the user explicitly prices writes like ordinary input, their unknown breakdown cannot affect cost.
    const write = pricing.cacheWritesAtInputPrice ? 0 : usage.cacheWriteTokens;
    // Cached tokens are included in normalized inputTokens. Unknown cache amounts/rates make price unknown.
    if (
      read !== undefined &&
      write !== undefined &&
      read >= 0 &&
      write >= 0 &&
      read + write <= usage.inputTokens &&
      (!read || pricing.cacheReadUsdPerMillion !== undefined) &&
      (!write || pricing.cacheWriteUsdPerMillion !== undefined)
    )
      cost =
        ((usage.inputTokens - read - write) * pricing.inputUsdPerMillion +
          usage.outputTokens * pricing.outputUsdPerMillion +
          read * (pricing.cacheReadUsdPerMillion ?? 0) +
          write * (pricing.cacheWriteUsdPerMillion ?? 0)) /
        1_000_000;
  }
  total.costUsd = total.costUsd !== null && cost !== null ? total.costUsd + cost : null;
}
export function assistantBudgetStop(usage: AssistantRunUsage, limits: AssistantLimits): string | undefined {
  if (limits.maxInputTokens !== undefined && (usage.inputTokens === null || usage.inputTokens >= limits.maxInputTokens))
    return usage.inputTokens === null
      ? 'Provider input usage is unknown; cannot continue within the token budget.'
      : 'Input token budget reached.';
  if (
    limits.maxTotalTokens !== undefined &&
    (usage.inputTokens === null || usage.outputTokens === null || usage.inputTokens + usage.outputTokens >= limits.maxTotalTokens)
  )
    return usage.inputTokens === null || usage.outputTokens === null
      ? 'Provider usage is unknown; cannot continue within the token budget.'
      : 'Total token budget reached.';
  if (limits.maxCostUsd !== undefined && (usage.costUsd === null || usage.costUsd >= limits.maxCostUsd))
    return usage.costUsd === null ? 'Provider cost is unknown; cannot continue within the dollar budget.' : 'Dollar budget reached.';
}
