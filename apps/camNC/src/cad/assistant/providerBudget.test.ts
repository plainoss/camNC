import { describe, expect, it, vi } from 'vitest';
import { parseProviderMessage, providerPayload, requestAssistant, type ProviderConfig } from './provider';
import { defaultProvider } from './keyStore';

const anthropic = { ...defaultProvider, model: 'recorded' };
const chat: ProviderConfig = { ...anthropic, kind: 'compatible', protocol: 'chat' };
const responses: ProviderConfig = { ...chat, protocol: 'responses' };
const request = (config = anthropic) => ({
  config,
  key: 'private-test-key',
  system: '',
  messages: [],
  tools: [],
  signal: new AbortController().signal,
});

describe('provider usage and completion', () => {
  it('normalizes inclusive Anthropic input and keeps breakdowns separate', () => {
    expect(
      parseProviderMessage(anthropic, {
        content: [{ type: 'text', text: 'Ready' }],
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 10,
          output_tokens: 30,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 20,
          output_tokens_details: { reasoning_tokens: 15 },
        },
      })
    ).toMatchObject({
      completion: 'complete',
      usage: { inputTokens: 130, outputTokens: 30, cacheReadTokens: 100, cacheWriteTokens: 20, reasoningTokens: 15 },
    });
  });
  it('keeps compatible totals inclusive and preserves Responses protocol items', () => {
    const usage = {
      input_tokens: 130,
      output_tokens: 30,
      input_tokens_details: { cached_tokens: 100, cache_write_tokens: 20 },
      output_tokens_details: { reasoning_tokens: 15 },
    };
    const output = [
      { type: 'reasoning', id: 'required-reasoning', summary: [] },
      { type: 'function_call', call_id: 'one', name: 'read_design', arguments: '{}' },
    ];
    expect(parseProviderMessage(responses, { status: 'completed', output, usage })).toMatchObject({
      responseItems: output,
      completion: 'complete',
      usage: { inputTokens: 130, outputTokens: 30, cacheReadTokens: 100, cacheWriteTokens: 20, reasoningTokens: 15 },
    });
    expect(
      parseProviderMessage(chat, {
        choices: [{ message: { content: 'Ready' }, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: 130,
          completion_tokens: 30,
          prompt_tokens_details: { cached_tokens: 100 },
          completion_tokens_details: { reasoning_tokens: 15 },
        },
      })
    ).toMatchObject({ completion: 'complete', usage: { inputTokens: 130, outputTokens: 30, cacheReadTokens: 100, reasoningTokens: 15 } });
  });
  it('leaves absent counts unknown and ignores malformed counts', () => {
    expect(parseProviderMessage(chat, { choices: [{ message: { content: 'Ready' } }] })).not.toHaveProperty('usage');
    expect(
      parseProviderMessage(chat, {
        choices: [{ message: { content: 'Ready' } }],
        usage: {
          prompt_tokens: -1,
          completion_tokens: '42',
          prompt_tokens_details: { cached_tokens: 0 },
          completion_tokens_details: { reasoning_tokens: 1.5 },
        },
      }).usage
    ).toEqual({ cacheReadTokens: 0 });
  });
  it('does not undercount input when Anthropic cache usage is malformed', () => {
    expect(
      parseProviderMessage(anthropic, { content: [], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: -1 } }).usage
    ).toEqual({ outputTokens: 5 });
  });
  it.each(['max_tokens', 'pause_turn', 'model_context_window_exceeded'])(
    'marks Anthropic %s incomplete despite partial calls',
    stop_reason => {
      expect(
        parseProviderMessage(anthropic, { stop_reason, content: [{ type: 'tool_use', id: 'one', name: 'check_design', input: '{broken' }] })
      ).toMatchObject({ completion: 'incomplete', calls: [] });
    }
  );
  it('marks truncated compatible calls incomplete despite partial JSON', () => {
    expect(
      parseProviderMessage(chat, {
        choices: [
          { finish_reason: 'length', message: { tool_calls: [{ id: 'one', function: { name: 'check_design', arguments: '{broken' } }] } },
        ],
      })
    ).toMatchObject({ completion: 'incomplete', calls: [] });
    expect(
      parseProviderMessage(responses, {
        status: 'incomplete',
        output: [{ type: 'function_call', call_id: 'one', name: 'check_design', arguments: '{broken' }],
      })
    ).toMatchObject({ completion: 'incomplete', calls: [] });
  });
  it('detects refusals across protocols', () => {
    expect(parseProviderMessage(anthropic, { stop_reason: 'refusal', content: [] }).completion).toBe('refused');
    expect(parseProviderMessage(chat, { choices: [{ message: { refusal: 'Cannot help' }, finish_reason: 'stop' }] }).completion).toBe(
      'refused'
    );
    expect(
      parseProviderMessage(responses, {
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'Cannot help' }] }],
      }).completion
    ).toBe('refused');
  });
});

describe('provider request bounds', () => {
  it.each([
    [anthropic, 'max_tokens'],
    [chat, 'max_completion_tokens'],
    [responses, 'max_output_tokens'],
  ] as const)('sets output limits for %j', (config, field) => {
    expect(providerPayload(request(config))).toHaveProperty(field, 8192);
    expect(providerPayload({ ...request(config), maxOutputTokens: 500 })).toHaveProperty(field, 500);
    expect(() => providerPayload({ ...request(config), maxOutputTokens: 0 })).toThrow(/positive/);
  });
  it('times out a stalled JSON body, aborts it and never retries', async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
        signal = init?.signal as AbortSignal;
        return { ok: true, json: () => new Promise(() => {}) } as Response;
      });
      const pending = expect(requestAssistant({ ...request(), timeoutMs: 50 }, fetcher)).rejects.toMatchObject({ code: 'timeout' });
      await vi.advanceTimersByTimeAsync(50);
      await pending;
      expect(signal?.aborted).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it('distinguishes caller cancellation while awaiting a body and releases the timer', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const fetcher = vi.fn<typeof fetch>(async () => ({ ok: true, json: () => new Promise(() => {}) }) as Response);
      const pending = expect(requestAssistant({ ...request(), signal: controller.signal }, fetcher)).rejects.toMatchObject({
        name: 'AbortError',
      });
      controller.abort();
      await pending;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it('returns safe actionable HTTP errors and records latency', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('private-test-key', { status: 429 }));
    await expect(requestAssistant(request(), fetcher)).rejects.toMatchObject({
      code: 'http',
      status: 429,
      message: expect.stringContaining('quota'),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      (await requestAssistant(request(), async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'Ready' }] }))))
        .latencyMs
    ).toBeGreaterThanOrEqual(0);
  });
});
