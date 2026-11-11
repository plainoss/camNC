import { expect, it } from 'vitest';
import { parseProviderMessage, providerPayload } from './provider';
import { defaultProvider, readAssistantCredentials } from './keyStore';
import { buildAssistantContext } from './context';

const config = { ...defaultProvider, model: 'claude-sonnet-5-5' };
const tools = [{ name: 'check_design', description: 'Check a copy', parameters: { type: 'object', properties: {} } }];
const payload = (system: string, promptCaching?: boolean) =>
  providerPayload({ config: { ...config, promptCaching }, system, tools, messages: [{ role: 'user', text: 'Build a tray.' }] });

it('preserves a stable instruction prefix and stays within four Anthropic cache breakpoints', () => {
  const before = payload('Stable core guide\n\nOpen design context (data):\n{"revision":1}');
  const after = payload('Stable core guide\n\nOpen design context (data):\n{"revision":2}');
  expect(before.cache_control).toEqual({ type: 'ephemeral' });
  expect((before.system as unknown[])[0]).toEqual((after.system as unknown[])[0]);
  expect((before.system as unknown[])[1]).not.toEqual((after.system as unknown[])[1]);
  expect(JSON.stringify(before).match(/"cache_control"/g)).toHaveLength(4);
  expect((before.tools as unknown[])[0]).toMatchObject({ cache_control: { type: 'ephemeral' } });
});

it('can disable cache writes and does not send Anthropic cache fields to compatible APIs', () => {
  const uncached = payload('Stable core guide', false);
  expect(uncached.system).toBe('Stable core guide');
  expect(JSON.stringify(uncached)).not.toContain('cache_control');
  const compatible = providerPayload({
    config: { ...config, kind: 'compatible', protocol: 'responses' },
    system: 'Core guide',
    tools,
    messages: [],
  });
  expect(JSON.stringify(compatible)).not.toContain('cache_control');
});

it('keeps an explicit stored cache opt-out and rejects malformed stored flags', () => {
  const stored = (promptCaching: unknown) => ({
    getItem: () => JSON.stringify({ config: { ...config, promptCaching }, key: 'test-key' }),
    removeItem: () => {},
  });
  expect(readAssistantCredentials(stored(false))?.config.promptCaching).toBe(false);
  expect(readAssistantCredentials(stored('false'))).toBeNull();
});

it('replays signed thinking with a retained tool batch without duplicating text or calls', () => {
  const content = [
    { type: 'thinking', thinking: '', signature: 'opaque-signed-thinking' },
    { type: 'text', text: 'Checking the tray.' },
    { type: 'tool_use', id: 'call', name: 'check_design', input: { source: 'd => {}' } },
  ];
  const answer = parseProviderMessage(config, {
    content,
    stop_reason: 'tool_use',
    usage: { output_tokens_details: { thinking_tokens: 300 } },
  });
  expect(answer.usage?.reasoningTokens).toBe(300);
  const messages = buildAssistantContext(
    [{ role: 'user', text: 'Build a tray.' }, answer, { role: 'tool', callId: 'call', text: 'Checked.' }],
    { images: false }
  );
  const encoded = providerPayload({ config, system: 'Core guide', tools, messages });
  const turns = encoded.messages as { role: string; content: unknown[] }[];
  expect(turns.find(turn => turn.role === 'assistant')?.content).toEqual(content);
  expect(JSON.stringify(encoded).match(/opaque-signed-thinking/g)).toHaveLength(1);
});
