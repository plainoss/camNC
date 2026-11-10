import { expect, it } from 'vitest';
import { assistantBudgetStop, createAssistantUsage, recordAssistantUsage, validateAssistantBudget } from './runBudget';

it('aggregates normalized tokens without double-counting cached input or reasoning', () => {
  const usage = createAssistantUsage();
  const pricing = { inputUsdPerMillion: 3, outputUsdPerMillion: 15, cacheReadUsdPerMillion: 0.3, cacheWriteUsdPerMillion: 3.75 };
  recordAssistantUsage(
    usage,
    {
      role: 'assistant',
      text: '',
      usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 400, cacheWriteTokens: 100, reasoningTokens: 20 },
    },
    pricing
  );
  expect(usage).toMatchObject({ calls: 1, inputTokens: 1000, outputTokens: 100, reasoningTokens: 20 });
  expect(usage.costUsd).toBeCloseTo(0.003495);
  expect(assistantBudgetStop(usage, { maxTotalTokens: 1100 })).toContain('Total');
  expect(assistantBudgetStop(usage, { maxCostUsd: 0.003 })).toContain('Dollar');
});

it('preserves unknown usage and pricing rather than reporting free requests', () => {
  const usage = createAssistantUsage();
  recordAssistantUsage(usage, { role: 'assistant', text: '' });
  recordAssistantUsage(usage, { role: 'assistant', text: '', usage: { inputTokens: 10, outputTokens: 2 } });
  expect(usage.inputTokens).toBeNull();
  expect(usage.costUsd).toBeNull();
  expect(assistantBudgetStop(usage, { maxInputTokens: 100 })).toContain('unknown');
  expect(() => validateAssistantBudget({ maxCostUsd: 1 })).toThrow(/pricing/);
  expect(() => validateAssistantBudget({ maxOutputTokens: -1 })).toThrow(/positive/);
});

it('accepts unset optional form values while requiring both base prices', () => {
  expect(() =>
    validateAssistantBudget(
      { maxTotalTokens: undefined },
      { inputUsdPerMillion: 1, outputUsdPerMillion: 2, cacheReadUsdPerMillion: undefined }
    )
  ).not.toThrow();
  expect(() => validateAssistantBudget({}, { inputUsdPerMillion: undefined!, outputUsdPerMillion: 2 })).toThrow(/both/);
  expect(() => validateAssistantBudget({ maxRunMs: 1.5 })).toThrow(/integers/);
});

it('prices missing cache-write breakdowns only when the user explicitly includes writes in the input rate', () => {
  const message = { role: 'assistant' as const, text: '', usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0 } };
  const pricing = { inputUsdPerMillion: 3, outputUsdPerMillion: 15 };
  const unknown = createAssistantUsage();
  recordAssistantUsage(unknown, message, pricing);
  expect(unknown.costUsd).toBeNull();
  const known = createAssistantUsage();
  recordAssistantUsage(known, message, { ...pricing, cacheWritesAtInputPrice: true });
  expect(known.cacheWriteTokens).toBeNull();
  expect(known.costUsd).toBeCloseTo(0.0045);
});
