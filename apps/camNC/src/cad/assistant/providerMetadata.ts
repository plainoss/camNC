import type { AssistantMessage, AssistantUsage, ProviderConfig } from './provider';

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

/** Missing or malformed usage remains unknown; compatible endpoints need not report it. */
export function providerMetadata(config: ProviderConfig, input: unknown): Pick<AssistantMessage, 'usage' | 'completion'> {
  const data = record(input),
    usage = record(data.usage);
  const anthropic = config.kind === 'anthropic';
  const responses = config.protocol === 'responses' && !anthropic;
  const inputDetails = record(usage[responses ? 'input_tokens_details' : 'prompt_tokens_details']);
  const outputDetails = record(usage[anthropic || responses ? 'output_tokens_details' : 'completion_tokens_details']);
  const cacheReadTokens = count(anthropic ? usage.cache_read_input_tokens : inputDetails.cached_tokens);
  const cacheWriteTokens = count(anthropic ? usage.cache_creation_input_tokens : inputDetails.cache_write_tokens);
  const rawInput = count(usage[anthropic || responses ? 'input_tokens' : 'prompt_tokens']);
  // Anthropic reports uncached input separately. Other protocols already include cache tokens in input totals.
  const invalidCache =
    anthropic &&
    ((usage.cache_read_input_tokens != null && cacheReadTokens === undefined) ||
      (usage.cache_creation_input_tokens != null && cacheWriteTokens === undefined));
  const totalInput =
    rawInput === undefined || invalidCache ? undefined : anthropic ? rawInput + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0) : rawInput;
  const normalized: AssistantUsage = {};
  const values = {
    inputTokens: count(totalInput),
    outputTokens: count(usage[anthropic || responses ? 'output_tokens' : 'completion_tokens']),
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens: count(outputDetails.reasoning_tokens),
  };
  for (const key of Object.keys(values) as (keyof AssistantUsage)[]) {
    if (values[key] !== undefined) normalized[key] = values[key];
  }
  let completion: AssistantMessage['completion'];
  if (anthropic) {
    if (data.stop_reason === 'refusal') completion = 'refused';
    else if (['max_tokens', 'pause_turn', 'model_context_window_exceeded'].includes(String(data.stop_reason))) completion = 'incomplete';
    else if (['end_turn', 'tool_use', 'stop_sequence'].includes(String(data.stop_reason))) completion = 'complete';
  } else if (responses) {
    const output = Array.isArray(data.output) ? data.output : [];
    const refused = output.some(item => {
      const content = record(item).content;
      return Array.isArray(content) && content.some(block => record(block).type === 'refusal');
    });
    if (refused || record(data.incomplete_details).reason === 'content_filter') completion = 'refused';
    else if (data.status === 'incomplete' || data.status === 'failed' || data.status === 'cancelled') completion = 'incomplete';
    else if (data.status === 'completed') completion = 'complete';
  } else {
    const choice = record(Array.isArray(data.choices) ? data.choices[0] : undefined);
    if (record(choice.message).refusal || choice.finish_reason === 'content_filter') completion = 'refused';
    else if (choice.finish_reason === 'length') completion = 'incomplete';
    else if (['stop', 'tool_calls', 'function_call'].includes(String(choice.finish_reason))) completion = 'complete';
  }
  return {
    ...(Object.keys(normalized).length && { usage: normalized }),
    ...(completion && { completion }),
  };
}
