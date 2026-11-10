import { createPlateDocument } from '@wbcnc/cad';
import { describe, expect, it, vi } from 'vitest';
import { assistantQuestion, resumeAssistantMessages, runDesignAssistant, type AssistantRunOptions } from './loop';
import { defaultProvider } from './keyStore';
import type { AssistantMessage } from './provider';

const answer = (name: string, source?: string): AssistantMessage => ({
  role: 'assistant',
  text: '',
  calls: [{ id: crypto.randomUUID(), name, arguments: source === undefined ? {} : { source } }],
});
const setup = (): AssistantRunOptions => {
  const base = createPlateDocument();
  return {
    base,
    config: { ...defaultProvider, model: 'recorded' },
    key: 'private',
    context: 'selected Plate',
    guide: 'Guide',
    examples: { plate: 'example' },
    signal: new AbortController().signal,
    messages: [
      { role: 'user', text: 'No visible screws.' },
      { role: 'user', text: 'Make it wider.' },
    ],
    check: vi.fn(async (_source, start) => ({ ok: true, document: { ...start, name: 'Changed' }, report: { ok: true } })),
  };
};

describe('recorded assistant repair loop', () => {
  it('pairs interrupted tool calls before continuing a conversation', () => {
    const call = answer('check_design', 'interrupted');
    const recovered = resumeAssistantMessages([call]);
    expect(recovered[1]).toMatchObject({ role: 'tool', callId: call.calls![0].id, text: expect.stringMatching(/interrupted/) });
    expect(resumeAssistantMessages(recovered)).toEqual(recovered);
  });
  it('reads tools, repairs on the original snapshot, offers a candidate and preserves earlier constraints', async () => {
    const options = setup();
    const replies = [
      answer('cad_script_guide'),
      answer('check_design', 'first'),
      answer('check_design', 'repaired'),
      { role: 'assistant', text: 'Proposal: wider, with no visible screws.' } as AssistantMessage,
    ];
    options.request = vi.fn<NonNullable<AssistantRunOptions['request']>>(async request => {
      expect(request.messages[0].text).toBe('No visible screws.');
      expect(request.system).toContain('selected Plate');
      return replies.shift()!;
    });
    options.check = vi.fn(async (source, start) => {
      expect(start).toEqual(options.base);
      start.parts[0].name = 'Changed in isolated copy';
      return { ok: source === 'repaired', document: start, report: { source } };
    });
    const result = await runDesignAssistant(options);
    expect(result.status).toBe('proposal');
    expect(result.checks).toBe(2);
    expect(options.base.parts[0].name).toBe('Plate');
    expect(result.proposal?.base).toEqual(options.base);
    expect(result.proposal?.document.parts[0].name).toBe('Changed in isolated copy');
    expect(result.messages.filter(message => message.role === 'tool')).toHaveLength(3);
  });

  it('supports a clarifying question without any design change', async () => {
    const options = setup();
    options.request = vi.fn<NonNullable<AssistantRunOptions['request']>>(async () => ({
      role: 'assistant',
      text: 'What height and joints should the stool have?',
    }));
    const result = await runDesignAssistant(options);
    expect(result.status).toBe('question');
    expect(result.proposal).toBeUndefined();
    expect(options.check).not.toHaveBeenCalled();
  });

  it('offers explicit choices and completes the tool protocol before waiting for a reply', async () => {
    const options = setup();
    const question: AssistantMessage = {
      role: 'assistant',
      text: '',
      calls: [
        {
          id: 'question-1',
          name: 'ask_user',
          arguments: {
            question: 'Which thickness?',
            choices: ['18 mm', '24 mm'],
          },
        },
      ],
    };
    options.request = vi.fn<NonNullable<AssistantRunOptions['request']>>(async () => question);
    const result = await runDesignAssistant(options);
    expect(result.status).toBe('question');
    expect(assistantQuestion(question)).toEqual({ question: 'Which thickness?', choices: ['18 mm', '24 mm'] });
    expect(result.messages.at(-1)).toMatchObject({ role: 'tool', callId: 'question-1' });
    expect(resumeAssistantMessages(result.messages)).toEqual(result.messages);
    expect(options.request).toHaveBeenCalledTimes(1);
    expect(options.check).not.toHaveBeenCalled();
    expect(result.proposal).toBeUndefined();
  });

  it('rejects malformed options and mixed question/edit batches without running their edits', async () => {
    const options = setup();
    const invalid: AssistantMessage = {
      role: 'assistant',
      text: '',
      calls: [
        {
          id: 'bad-question',
          name: 'ask_user',
          arguments: {
            question: 'Thickness?',
            choices: ['18 mm', '18 mm'],
          },
        },
      ],
    };
    const mixed: AssistantMessage = {
      ...invalid,
      calls: [
        { id: 'mixed-question', name: 'ask_user', arguments: { question: 'Thickness?', choices: ['18 mm', '24 mm'] } },
        { id: 'mixed-check', name: 'check_design', arguments: { source: 'd => {}' } },
      ],
    };
    const replies: AssistantMessage[] = [invalid, mixed, { role: 'assistant', text: 'Question: what thickness?' }];
    options.request = vi.fn<NonNullable<AssistantRunOptions['request']>>(async () => replies.shift()!);
    const result = await runDesignAssistant(options);
    expect(assistantQuestion(invalid)).toBeUndefined();
    expect(assistantQuestion(mixed)).toBeUndefined();
    expect(result.status).toBe('question');
    expect(result.messages.filter(message => message.role === 'tool')).toHaveLength(3);
    expect(resumeAssistantMessages(result.messages)).toEqual(result.messages);
    expect(options.check).not.toHaveBeenCalled();
  });

  it.each([
    { question: '', choices: ['18 mm', '24 mm'] },
    { question: 'Thickness?', choices: ['18 mm'] },
    { question: 'Thickness?', choices: ['1', '2', '3', '4', '5'] },
    { question: 'Thickness?', choices: ['18 mm', 24] },
    { question: 'Thickness?', choices: ['18 mm', ' '] },
    { question: 'Thickness?', choices: ['18 mm', ' 18 mm '] },
    { question: 'Thickness?', choices: ['18 mm', 'x'.repeat(201)] },
  ])('does not turn malformed question arguments into response buttons: %j', argumentsValue => {
    expect(
      assistantQuestion({
        role: 'assistant',
        text: '',
        calls: [{ id: 'question', name: 'ask_user', arguments: argumentsValue }],
      })
    ).toBeUndefined();
  });

  it('never exposes Apply and bounds both model turns and checked scripts', async () => {
    const options = setup();
    options.maxChecks = 2;
    options.maxTurns = 4;
    options.request = vi.fn<NonNullable<AssistantRunOptions['request']>>(async request => {
      expect(request.tools.map(tool => tool.name)).not.toContain('apply');
      return answer('check_design', 'same script');
    });
    const result = await runDesignAssistant(options);
    expect(result.status).toBe('exhausted');
    expect(result.proposal).toBeUndefined();
    expect(options.check).toHaveBeenCalledTimes(2);
    expect(options.request).toHaveBeenCalledTimes(4);
  });

  it('does not offer a previously passing candidate after the last check fails', async () => {
    const options = setup();
    const replies = [
      answer('check_design', 'good'),
      answer('check_design', 'bad'),
      { role: 'assistant', text: 'Please clarify.' } as AssistantMessage,
    ];
    options.request = vi.fn<NonNullable<AssistantRunOptions['request']>>(async () => replies.shift()!);
    options.check = vi.fn(async (source, start) => ({ ok: source === 'good', document: start, report: {} }));
    expect((await runDesignAssistant(options)).proposal).toBeUndefined();
  });

  it('stops without publishing a proposal when aborted during a check', async () => {
    const options = setup();
    const abort = new AbortController();
    options.signal = abort.signal;
    options.request = vi.fn<NonNullable<AssistantRunOptions['request']>>(async () => answer('check_design', 'd => {}'));
    options.check = vi.fn(async (_source, start) => {
      abort.abort();
      return { ok: true, document: start, report: {} };
    });
    const result = await runDesignAssistant(options);
    expect(result.status).toBe('stopped');
    expect(result.proposal).toBeUndefined();
  });
});
