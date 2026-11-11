import { describe, expect, it, vi } from 'vitest';
import {
  parseProviderMessage,
  providerPayload,
  providerUrl,
  requestAssistant,
  type AssistantMessage,
  type ProviderConfig,
} from './provider';
import {
  ASSISTANT_KEY_STORAGE,
  defaultProvider,
  readAssistantCredentials,
  rememberAssistantCredentials,
  setAssistantCredentials,
} from './keyStore';

const config: ProviderConfig = { ...defaultProvider, model: 'recorded-model', images: true };
const tools = [{ name: 'check_design', description: 'Check a design', parameters: { type: 'object', properties: {} } }];
const messages: AssistantMessage[] = [
  { role: 'user', text: 'No visible screws. Make a shelf.', images: [{ name: 'shelf.png', mediaType: 'image/png', data: 'aGVsbG8=' }] },
  { role: 'assistant', text: '', calls: [{ id: 'call-1', name: 'check_design', arguments: { source: 'd => {}' } }] },
  { role: 'tool', callId: 'call-1', text: '{"ok":true}' },
];

describe('assistant provider protocols', () => {
  it('encodes Anthropic tools, results, images and prior user constraints', () => {
    const payload = providerPayload({ config, system: 'Designs only', messages, tools });
    expect(payload).toMatchObject({ model: 'recorded-model', tools: [{ name: 'check_design', input_schema: { type: 'object' } }] });
    expect(JSON.stringify(payload)).toContain('No visible screws');
    expect(JSON.stringify(payload)).toContain('tool_result');
    expect(JSON.stringify(payload)).toContain('image/png');
    expect(
      parseProviderMessage(config, {
        content: [
          { type: 'text', text: 'Ready' },
          { type: 'tool_use', id: '1', name: 'check_design', input: { source: 'x' } },
        ],
      })
    ).toMatchObject({ text: 'Ready', calls: [{ arguments: { source: 'x' } }] });
  });

  it('supports compatible Chat Completions and Responses with preserved reasoning items', () => {
    const chat = { ...config, kind: 'compatible' as const };
    expect(providerUrl(chat)).toBe('https://api.anthropic.com/v1/chat/completions');
    expect(providerPayload({ config: chat, system: 'Designs only', messages, tools })).toMatchObject({
      messages: [
        { role: 'system' },
        { role: 'user' },
        { role: 'assistant', tool_calls: [{ id: 'call-1' }] },
        { role: 'tool', tool_call_id: 'call-1' },
      ],
    });
    expect(
      parseProviderMessage(chat, {
        choices: [
          { message: { content: null, tool_calls: [{ id: '2', function: { name: 'check_design', arguments: '{"source":"x"}' } }] } },
        ],
      }).calls?.[0].arguments
    ).toEqual({ source: 'x' });
    // Gemini 3 refuses a follow-up whose tool calls lack the thought signature it returned with them.
    const signed = parseProviderMessage(chat, {
      choices: [
        {
          message: {
            tool_calls: [
              { id: '3', function: { name: 'read_design', arguments: '{}' }, extra_content: { google: { thought_signature: 'sig' } } },
            ],
          },
        },
      ],
    });
    expect(providerPayload({ config: chat, system: '', messages: [messages[0], signed], tools })).toMatchObject({
      messages: [{}, {}, { tool_calls: [{ id: '3', extra_content: { google: { thought_signature: 'sig' } } }] }],
    });
    const responses = { ...chat, protocol: 'responses' as const };
    const output = [
      { type: 'reasoning', id: 'reason-1', summary: [] },
      { type: 'function_call', call_id: 'call-1', name: 'check_design', arguments: '{}' },
    ];
    const parsed = parseProviderMessage(responses, { output });
    const payload = providerPayload({ config: responses, system: 'Designs only', messages: [messages[0], parsed, messages[2]], tools });
    expect(payload).toMatchObject({ store: false, input: expect.arrayContaining(output) });
    expect(JSON.stringify(payload)).toContain('function_call_output');
  });

  it('requires tool and image capability, validates addresses and refuses malformed calls', () => {
    expect(() => providerPayload({ config: { ...config, tools: false }, system: '', messages, tools })).toThrow(/tools/);
    expect(() => providerPayload({ config: { ...config, images: false }, system: '', messages, tools })).toThrow(/text-only/);
    for (const endpoint of ['http://example.com', 'https://user:secret@example.com', 'https://example.com?key=secret'])
      expect(() => providerUrl({ ...config, endpoint })).toThrow();
    expect(providerUrl({ ...config, endpoint: 'http://localhost:1234/v1' })).toContain('localhost');
    expect(() => parseProviderMessage(config, { content: [{ type: 'tool_use', input: [] }] })).toThrow(/invalid/);
  });

  it('keeps every result adjacent to a parallel tool-call batch before adding view images', () => {
    const image = messages[0].images![0];
    const batch: AssistantMessage[] = [
      messages[0],
      {
        role: 'assistant',
        text: '',
        calls: [
          { id: 'a', name: 'check_design', arguments: {} },
          { id: 'b', name: 'cad_script_guide', arguments: {} },
        ],
      },
      { role: 'tool', callId: 'a', text: 'checked', images: [image] },
      { role: 'tool', callId: 'b', text: 'guide' },
    ];
    const chat = providerPayload({ config: { ...config, kind: 'compatible' }, system: '', messages: batch, tools });
    expect((chat.messages as { role: string }[]).map(message => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'tool',
      'user',
    ]);
    const responses = providerPayload({
      config: { ...config, kind: 'compatible', protocol: 'responses' },
      system: '',
      messages: batch,
      tools,
    });
    const items = responses.input as { type?: string; role?: string }[];
    expect(items.map(item => item.type ?? item.role)).toEqual([
      'user',
      'assistant',
      'function_call',
      'function_call',
      'function_call_output',
      'function_call_output',
      'user',
    ]);
  });

  it('calls only the chosen provider and keeps keys out of bodies and failures', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'Ready' }] }), { status: 200 })
    );
    const request = { config, system: 'Designs only', messages, tools, key: 'test-private-key', signal: new AbortController().signal };
    expect((await requestAssistant(request, fetcher)).text).toBe('Ready');
    expect(fetcher.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages');
    const options = fetcher.mock.calls[0][1] as RequestInit;
    expect(options.credentials).toBe('omit');
    expect(options.redirect).toBe('error');
    expect(options.body).not.toContain(request.key);
    expect(options.headers).toMatchObject({ 'x-api-key': request.key, 'anthropic-dangerous-direct-browser-access': 'true' });
    await expect(
      requestAssistant(
        request,
        vi.fn(async () => new Response(request.key, { status: 401 }))
      )
    ).rejects.toThrow('HTTP 401');
    await expect(
      requestAssistant(
        request,
        vi.fn(async () => {
          throw Error(request.key);
        })
      )
    ).rejects.toThrow(/browser/);
  });
});

describe('local assistant credentials', () => {
  it('retains a session-only connection across dock remounts and forgets both stores', () => {
    const value = { config, key: 'session-only-test-key' };
    setAssistantCredentials(value, false);
    expect(localStorage.getItem(ASSISTANT_KEY_STORAGE)).toBeNull();
    expect(readAssistantCredentials()).toEqual(value);
    rememberAssistantCredentials(null);
    expect(readAssistantCredentials()).toBeNull();
    expect(localStorage.getItem(ASSISTANT_KEY_STORAGE)).toBeNull();
  });
  it('touches only its dedicated key and forgets it without settings or account sync', () => {
    const entries = new Map<string, string>();
    const storage = {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        entries.set(key, value);
      },
      removeItem: (key: string) => {
        entries.delete(key);
      },
    };
    const value = { config, key: 'private-key' };
    rememberAssistantCredentials(value, storage);
    expect([...entries.keys()]).toEqual([ASSISTANT_KEY_STORAGE]);
    expect(readAssistantCredentials(storage)).toEqual(value);
    rememberAssistantCredentials(null, storage);
    expect(readAssistantCredentials(storage)).toBeNull();
    storage.setItem(ASSISTANT_KEY_STORAGE, '{bad json');
    expect(readAssistantCredentials(storage)).toBeNull();
  });
});
