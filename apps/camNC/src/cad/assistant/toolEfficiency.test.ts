import { createPlateDocument, evaluateCadDocument } from '@wbcnc/cad';
import { expect, it, vi } from 'vitest';
import { runDesignAssistant, type AssistantRunOptions } from './loop';
import { defaultProvider } from './keyStore';
import type { AssistantMessage } from './provider';

const call = (args: Record<string, unknown>, name = 'check_design'): AssistantMessage => ({
  role: 'assistant',
  text: '',
  calls: [{ id: crypto.randomUUID(), name, arguments: args }],
});
const setup = (): AssistantRunOptions => ({
  base: createPlateDocument(),
  config: { ...defaultProvider, model: 'recorded', images: true },
  key: '',
  messages: [{ role: 'user', text: 'Make a tray.' }],
  context: '',
  guide: '',
  examples: {},
  signal: new AbortController().signal,
  check: vi.fn(async (_source, base) => ({ ok: true, document: base, report: { ok: true } })),
});
it('checks trusted recipes and repairs an immutable script using a short patch', async () => {
  const options = setup();
  let turn = 0;
  options.request = async request => {
    if (!turn++) return call({ recipe: 'pebble-tray', parameters: { width: 240, height: 160 }, views: ['top'] });
    if (turn === 2) {
      const checked = JSON.parse(request.messages.findLast(message => message.role === 'tool')!.text);
      expect(checked).toMatchObject({ recipe: 'pebble-tray', scriptId: expect.any(String), hash: expect.stringMatching(/^sha256:/) });
      return call({ scriptId: checked.scriptId, expectedHash: checked.hash, patches: [{ oldText: '"240mm"', newText: '"250mm"' }] });
    }
    return { role: 'assistant', text: 'Proposal: checked.' };
  };
  const result = await runDesignAssistant(options);
  expect(result.status).toBe('proposal');
  expect(options.check).toHaveBeenCalledTimes(2);
  const calls = vi.mocked(options.check).mock.calls;
  expect(calls[0][0]).toContain('240mm');
  expect(calls[1][0]).toContain('250mm');
  expect(calls[0][3]).toEqual({ views: ['top'] });
  expect(calls[1][1]).toEqual(options.base);
});
it('does not offer a candidate whose script passes but confirmed measured dimensions fail', async () => {
  const options = setup();
  options.requirements = { width: 280 };
  const evaluated = evaluateCadDocument(options.base);
  options.check = async (_source, base) => ({
    ok: true,
    document: base,
    report: { ok: true },
    parts: evaluated.parts,
    trustedReport: {
      ok: true,
      status: 'solved',
      errors: [],
      warnings: [],
      parts: [{ name: 'Plate', thickness: 18, outline: { at: [0, 0], size: [120, 80] }, cuts: [], sketches: [] }],
    },
  });
  const replies = [call({ source: 'd => {}' }), { role: 'assistant', text: 'Proposal: accepted.' } as AssistantMessage];
  options.request = async () => replies.shift()!;
  const result = await runDesignAssistant(options);
  expect(result.proposal).toBeUndefined();
  expect(result.status).toBe('exhausted');
  expect(result.messages.find(message => message.role === 'tool')?.text).toContain('"requirements":{"ok":false');
});

it('requires a complete final check and refuses changed final geometry', async () => {
  for (const changed of [false, true]) {
    const options = setup();
    options.maxChecks = 1;
    options.finalize = vi.fn(async checked => ({
      ...checked,
      document: changed ? { ...checked.document, name: 'Different' } : checked.document,
    }));
    const replies = [
      call({ source: 'd => {}' }),
      call({}, 'finalize_design'),
      { role: 'assistant', text: 'Proposal: complete.' } as AssistantMessage,
    ];
    options.request = async () => replies.shift()!;
    const result = await runDesignAssistant(options);
    expect(options.finalize).toHaveBeenCalledTimes(1);
    expect(Boolean(result.proposal)).toBe(!changed);
  }
});

it('never treats a geometry-only success as a proposal', async () => {
  const options = setup();
  options.finalize = vi.fn(async checked => checked);
  const replies = [call({ source: 'd => {}' }), { role: 'assistant', text: 'Proposal: skip full check.' } as AssistantMessage];
  options.request = async () => replies.shift()!;
  const result = await runDesignAssistant(options);
  expect(result.proposal).toBeUndefined();
  expect(options.finalize).not.toHaveBeenCalled();
});
