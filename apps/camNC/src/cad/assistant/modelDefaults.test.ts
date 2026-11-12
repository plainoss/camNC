import { describe, expect, it, vi } from 'vitest';
import { defaultImageModel, defaultTextModel, detectKeyProvider, listProviderModels, nativeImageFromConnection } from './modelDefaults';
import { testAssistantConnection } from './connectionTest';
import { connectionPresets } from './connectionPresets';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('provider defaults from a key alone', () => {
  it('recognises the provider from the key prefix', () => {
    expect(detectKeyProvider(' sk-ant-api03-x ')).toBe('anthropic');
    expect(detectKeyProvider('sk-proj-x')).toBe('openai');
    expect(detectKeyProvider('AIzaSyX')).toBe('gemini');
    expect(detectKeyProvider('abc')).toBeNull();
  });

  it("chooses the newest main-line text model and image model from the provider's list", () => {
    expect(defaultTextModel('anthropic', ['claude-haiku-5-5', 'claude-sonnet-5', 'claude-sonnet-5-5', 'claude-opus-5-5'])).toBe(
      'claude-sonnet-5-5'
    );
    expect(defaultTextModel('openai', ['gpt-5.2', 'gpt-5.2-mini', 'gpt-6', 'gpt-6-nano', 'gpt-image-2', 'gpt-6-realtime', 'o4'])).toBe(
      'gpt-6'
    );
    expect(defaultImageModel('openai', ['gpt-image-1', 'gpt-image-2', 'gpt-image-2-mini', 'dall-e-3'])).toBe('gpt-image-2');
    expect(defaultImageModel('openai', ['dall-e-3', 'gpt-6'])).toBe('dall-e-3');
    expect(defaultImageModel('anthropic', ['gpt-image-2'])).toBeUndefined();
    const gemini = [
      'gemini-3-pro-preview',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.5-flash-image',
      'gemini-3.5-flash-preview-tts',
      'gemini-4-flash-preview',
      'gemini-embedding-001',
      'imagen-4.0-generate-001',
      'imagen-4.0-fast-generate-001',
      'imagen-4.0-ultra-generate-001',
    ];
    expect(defaultTextModel('gemini', gemini)).toBe('gemini-3.5-flash');
    expect(defaultTextModel('gemini', ['gemini-4-flash-preview', 'gemini-3-pro-preview'])).toBe('gemini-4-flash-preview');
    expect(defaultImageModel('gemini', gemini)).toBe('imagen-4.0-generate-001');
    expect(defaultImageModel('gemini', ['gemini-3.5-flash', 'gemini-3.5-flash-image'])).toBeUndefined();
  });

  it('lists models with the same key and endpoint, and treats a refusal as no list', async () => {
    const config = { ...connectionPresets[1]!.config, model: '' };
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => json(200, { data: [{ id: 'gpt-6' }, { id: 7 }] }));
    expect(await listProviderModels(config, 'sk-x', new AbortController().signal, fetcher)).toEqual(['gpt-6']);
    expect(String(fetcher.mock.calls[0]![0])).toBe('https://api.openai.com/v1/models');
    expect((fetcher.mock.calls[0]![1]!.headers as Record<string, string>).authorization).toBe('Bearer sk-x');
    await expect(listProviderModels(config, 'sk-x', new AbortController().signal, async () => json(403, {}))).rejects.toThrow('rejected');
    expect(await listProviderModels(config, 'sk-x', new AbortController().signal, async () => json(404, {}))).toBeNull();
    await expect(
      listProviderModels(config, 'sk-x', new AbortController().signal, async () => {
        throw new TypeError('Failed to fetch');
      })
    ).rejects.toThrow('could not reach');
  });

  it('reports a rejected key or an unreachable provider for a test without a model to fall back on', async () => {
    const signal = new AbortController().signal;
    for (const preset of [connectionPresets[1]!, connectionPresets.find(item => item.id === 'gemini')!]) {
      const config = { ...preset.config, model: '' };
      await expect(testAssistantConnection(config, 'k', signal, async () => json(401, {}))).rejects.toThrow('rejected this key');
      await expect(testAssistantConnection(config, 'k', signal, async () => json(400, { error: 'API key not valid' }))).rejects.toThrow(
        'rejected this key'
      );
      await expect(
        testAssistantConnection(config, 'k', signal, async () => {
          throw new TypeError('Failed to fetch');
        })
      ).rejects.toThrow('could not reach this provider');
    }
  });

  it('lists Gemini models by bare ID with a bearer key', async () => {
    const config = { ...connectionPresets.find(preset => preset.id === 'gemini')!.config, model: '' };
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      json(200, { data: [{ id: 'models/gemini-3.5-flash' }, { id: 'models/imagen-4.0-generate-001' }] })
    );
    expect(await listProviderModels(config, 'AIza-x', new AbortController().signal, fetcher)).toEqual([
      'gemini-3.5-flash',
      'imagen-4.0-generate-001',
    ]);
    expect(String(fetcher.mock.calls[0]![0])).toBe('https://generativelanguage.googleapis.com/v1beta/openai/models');
  });

  it('fills blank models during the connection test and falls back to the preset when listing fails', async () => {
    const toolCall = {
      output: [{ type: 'function_call', call_id: 'c', name: 'connection_check', arguments: '{"ok":true}' }],
      status: 'completed',
    };
    const fetcher = vi.fn(async (url: RequestInfo | URL) =>
      String(url).endsWith('/models') ? json(200, { data: [{ id: 'gpt-6' }, { id: 'gpt-image-2' }] }) : json(200, toolCall)
    );
    const openai = await testAssistantConnection(
      { ...connectionPresets[1]!.config, model: '' },
      'sk-x',
      new AbortController().signal,
      fetcher
    );
    expect(openai.config).toMatchObject({ model: 'gpt-6', imageModel: 'gpt-image-2' });
    const anthropicCall = {
      content: [{ type: 'tool_use', id: 't', name: 'connection_check', input: { ok: true } }],
      stop_reason: 'tool_use',
    };
    const anthropic = await testAssistantConnection(
      { ...connectionPresets[0]!.config, model: '' },
      'sk-ant-x',
      new AbortController().signal,
      async url => (String(url).includes('/models') ? json(500, {}) : json(200, anthropicCall))
    );
    expect(anthropic.config.model).toBe('claude-sonnet-5-5');
    expect(anthropic.config.imageModel).toBeUndefined();
    await expect(
      testAssistantConnection(
        { ...connectionPresets.find(preset => preset.id === 'other')!.config, endpoint: 'https://llm.example.com/v1', model: '' },
        'k',
        new AbortController().signal,
        async () => json(404, {})
      )
    ).rejects.toThrow('Enter a model ID under Models');
  });

  it('hands Carve the same provider and key for images, and nothing for Anthropic', () => {
    const openai = { key: 'sk-x', config: { ...connectionPresets[1]!.config, model: 'gpt-6', imageModel: 'gpt-image-2' } };
    expect(nativeImageFromConnection(openai, 'medium')).toEqual({
      endpoint: 'https://api.openai.com/v1',
      model: 'gpt-image-2',
      key: 'sk-x',
      quality: 'medium',
    });
    expect(
      nativeImageFromConnection({ key: 'sk-ant', config: { ...connectionPresets[0]!.config, model: 'claude-sonnet-5-5' } })
    ).toBeNull();
    expect(nativeImageFromConnection(null)).toBeNull();
  });
});
