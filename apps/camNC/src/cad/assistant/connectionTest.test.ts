import { describe, expect, it, vi } from 'vitest';
import { testAssistantConnection } from './connectionTest';
import { connectionLabel, connectionPreset, connectionPresets } from './connectionPresets';
import type { ProviderConfig } from './provider';

const anthropic: ProviderConfig = { ...connectionPresets[0]!.config, model: 'claude-sonnet-5-5' };
const toolCall = { content: [{ type: 'tool_use', id: 't1', name: 'connection_check', input: { ok: true } }], stop_reason: 'tool_use' };
const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('assistant connection test', () => {
  it('confirms tools and images with one small request without design data', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => respond(200, toolCall));
    const result = await testAssistantConnection(anthropic, 'test-key', new AbortController().signal, fetcher);
    expect(result).toEqual({ config: { ...anthropic, tools: true, images: true }, notes: [] });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetcher.mock.calls[0]![1]!.body));
    expect(body.max_tokens).toBe(64);
    expect(JSON.stringify(body)).toContain('image/png');
  });

  it('turns images off when the model refuses them and the text retry works', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(respond(400, { error: 'images not supported' }))
      .mockResolvedValueOnce(respond(200, toolCall));
    const result = await testAssistantConnection(anthropic, 'test-key', new AbortController().signal, fetcher);
    expect(result.config.images).toBe(false);
    expect(result.notes[0]).toContain('does not accept images');
    expect(JSON.stringify(JSON.parse(String(fetcher.mock.calls[1]![1]!.body)))).not.toContain('image/png');
  });

  it('explains rejected keys, unknown models, blocked browser access and missing tool calls', async () => {
    const signal = new AbortController().signal;
    await expect(testAssistantConnection(anthropic, 'k', signal, async () => respond(401, {}))).rejects.toThrow('rejected this key');
    await expect(testAssistantConnection({ ...anthropic, images: false }, 'k', signal, async () => respond(404, {}))).rejects.toThrow(
      'Check the model ID'
    );
    await expect(
      testAssistantConnection(anthropic, 'k', signal, async () => {
        throw new TypeError('Failed to fetch');
      })
    ).rejects.toThrow('(CORS)');
    await expect(
      testAssistantConnection(anthropic, 'k', signal, async () =>
        respond(200, { content: [{ type: 'text', text: 'Hello' }], stop_reason: 'end_turn' })
      )
    ).rejects.toThrow('did not call a tool');
  });
});

describe('connection presets', () => {
  it('recognizes a saved preset and names the model without the key', () => {
    expect(connectionPreset(anthropic).id).toBe('anthropic');
    expect(connectionPreset({ ...anthropic, endpoint: 'https://api.anthropic.com/v1/' }).id).toBe('anthropic');
    expect(connectionPreset({ ...anthropic, kind: 'compatible', endpoint: 'https://llm.example.com/v1' }).id).toBe('other');
    expect(connectionLabel(anthropic)).toBe('Claude Sonnet 5.5');
    expect(connectionLabel({ ...anthropic, kind: 'compatible', endpoint: 'https://llm.example.com/v1', model: 'local-7b' })).toBe(
      'local-7b · llm.example.com'
    );
  });
});
