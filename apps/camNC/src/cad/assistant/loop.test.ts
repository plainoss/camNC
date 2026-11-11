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
      text: 'Question: What height and joints should the stool have?',
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

  it('keeps optional illustrations in a question and falls back to text when a sketch is invalid', async () => {
    const options = setup();
    const sketches = [{ choiceIndex: 0, shapes: [{ kind: 'rect', coords: [10, 10, 80, 50] }] }];
    const question: AssistantMessage = {
      role: 'assistant',
      text: '',
      calls: [
        {
          id: 'visual-question',
          name: 'ask_user',
          arguments: {
            question: 'Which shape?',
            choices: ['Rectangle', 'Ellipse'],
            sketches,
          },
        },
      ],
    };
    options.request = vi.fn<NonNullable<AssistantRunOptions['request']>>(async () => question);
    const result = await runDesignAssistant(options);
    expect(result.status).toBe('question');
    expect(assistantQuestion(question)?.sketches).toEqual(sketches);
    expect(options.request).toHaveBeenCalledTimes(1);
    expect(options.check).not.toHaveBeenCalled();
    question.calls![0].arguments.sketches = [{ choiceIndex: 0, shapes: '<svg onload="bad()" />' }];
    expect(assistantQuestion(question)).toEqual({ question: 'Which shape?', choices: ['Rectangle', 'Ellipse'] });
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
      return answer('check_design', `script ${crypto.randomUUID()}`);
    });
    const result = await runDesignAssistant(options);
    expect(result.status).toBe('exhausted');
    expect(result.proposal).toBeUndefined();
    expect(options.check).toHaveBeenCalledTimes(2);
    expect(options.request).toHaveBeenCalledTimes(3);
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

it('uses one final response without execution tools after the last permitted check', async () => {
  const options = setup();
  options.maxChecks = 1;
  options.request = vi.fn(async request =>
    request.tools.length ? answer('check_design', 'good') : { role: 'assistant' as const, text: 'Proposal: checked.' }
  );
  const result = await runDesignAssistant(options);
  expect(result.status).toBe('proposal');
  expect(result.usage.calls).toBe(2);
  expect(options.check).toHaveBeenCalledTimes(1);
  expect(vi.mocked(options.request).mock.calls[1][0].tools).toEqual([]);
});

it('reuses an identical script on the same snapshot without spending another check', async () => {
  const options = setup();
  const replies = [
    answer('check_design', 'same'),
    answer('check_design', 'same'),
    { role: 'assistant' as const, text: 'Proposal: checked.' },
  ];
  options.request = vi.fn(async () => replies.shift()!);
  const result = await runDesignAssistant(options);
  expect(options.check).toHaveBeenCalledTimes(1);
  expect(result.checks).toBe(1);
  expect(result.usage.reusedChecks).toBe(1);
});

it.each(['incomplete', 'refused'] as const)('does not publish a candidate for a %s final response', async completion => {
  const options = setup();
  const replies = [answer('check_design', 'good'), { role: 'assistant' as const, text: 'Proposal: checked.', completion }];
  options.request = vi.fn(async () => replies.shift()!);
  const result = await runDesignAssistant(options);
  expect(result.status).toBe('exhausted');
  expect(result.proposal).toBeUndefined();
});

it.each(['', 'Ready', 'Proposal:', 'Question:'])('rejects an ambiguous final response %j', async text => {
  const options = setup();
  const replies = [answer('check_design', 'good'), { role: 'assistant' as const, text }];
  options.request = vi.fn(async () => replies.shift()!);
  expect((await runDesignAssistant(options)).proposal).toBeUndefined();
});

it('does not lose a checked proposal when a later unrelated tool fails', async () => {
  const options = setup();
  options.guideSections = Object.defineProperty({}, 'broken', {
    get() {
      throw new Error('bad section');
    },
  });
  const broken = answer('cad_script_guide');
  broken.calls![0].arguments = { section: 'broken' };
  const replies = [answer('check_design', 'good'), broken, { role: 'assistant' as const, text: 'Proposal: checked.' }];
  options.request = vi.fn(async () => replies.shift()!);
  expect((await runDesignAssistant(options)).status).toBe('proposal');
});

it('requests views only on demand and automatically for the latest reference image', async () => {
  const options = setup();
  options.config.images = true;
  options.messages.push({ role: 'user', text: 'Match this', images: [{ name: 'ref', mediaType: 'image/png', data: 'AA==' }] });
  const replies = [answer('check_design', 'good'), { role: 'assistant' as const, text: 'Proposal: checked.' }];
  options.request = vi.fn(async () => replies.shift()!);
  await runDesignAssistant(options);
  expect(vi.mocked(options.check).mock.calls[0][3]).toEqual({ views: true });
});

it('checks with the cutter the assistant names, as its own check, and refuses an implausible bit', async () => {
  const options = setup();
  const withBit = (bit: unknown) => {
    const call = answer('check_design', 'mortise');
    call.calls![0].arguments.bit = bit;
    return call;
  };
  const replies = [withBit(6), withBit(6), withBit(3), withBit(0), { role: 'assistant' as const, text: 'Proposal: checked.' }];
  const emitted: AssistantMessage[] = [];
  options.onMessage = message => emitted.push(message);
  options.request = vi.fn(async () => replies.shift()!);
  const result = await runDesignAssistant(options);
  expect(vi.mocked(options.check).mock.calls.map(call => call[3])).toEqual([
    { views: false, bit: 6 },
    { views: false, bit: 3 },
  ]);
  expect(result.usage.reusedChecks).toBe(1);
  expect(emitted.filter(message => message.role === 'tool').at(-1)?.text).toContain('flat bit diameter');
});

it('stops before requesting overlarge input and stops when capped provider usage is unknown', async () => {
  const options = setup();
  options.limits = { maxInputCharacters: 1 };
  options.request = vi.fn(async () => answer('cad_script_guide'));
  expect((await runDesignAssistant(options)).status).toBe('exhausted');
  expect(options.request).not.toHaveBeenCalled();
  options.limits = { maxTotalTokens: 1000 };
  const result = await runDesignAssistant(options);
  expect(result.status).toBe('exhausted');
  expect(result.usage.calls).toBe(1);
  expect(result.usage.inputTokens).toBeNull();
  expect(result.stopReason).toContain('unknown');
});

it('passes output and request limits and keeps actual usage on an explicit question', async () => {
  const options = setup();
  options.limits = { maxOutputTokens: 123, maxRequestMs: 456 };
  options.request = vi.fn(async () => ({
    role: 'assistant' as const,
    text: 'Question: Which joint?',
    usage: { inputTokens: 10, outputTokens: 5 },
  }));
  const result = await runDesignAssistant(options);
  expect(vi.mocked(options.request).mock.calls[0][0]).toMatchObject({ maxOutputTokens: 123, timeoutMs: 456 });
  expect(result.usage).toMatchObject({ calls: 1, inputTokens: 10, outputTokens: 5, costUsd: null });
});

it('enforces the image byte budget independently of text length', async () => {
  const options = setup();
  options.config.images = true;
  options.limits = { maxImageBytes: 1 };
  options.messages.push({ role: 'user', text: 'Match', images: [{ name: 'ref', mediaType: 'image/png', data: 'AAAA' }] });
  options.request = vi.fn(async () => ({ role: 'assistant' as const, text: 'Question: How wide?' }));
  const result = await runDesignAssistant(options);
  expect(result.stopReason).toContain('Image');
  expect(options.request).not.toHaveBeenCalled();
});

it('offers detailed report data only when requested', async () => {
  const options = setup();
  options.report = { errors: [], warnings: [], parts: [{ id: 'p', name: 'Plate', features: [{ name: 'Detailed hole' }] }] };
  const read = answer('read_design_report');
  read.calls![0].arguments = { section: 'parts' };
  const replies = [read, { role: 'assistant' as const, text: 'Question: Which hole?' }];
  options.request = vi.fn(async () => replies.shift()!);
  const result = await runDesignAssistant(options);
  expect(result.messages.find(message => message.role === 'tool')?.text).toContain('Detailed hole');
});

it.each(['constructor', '__proto__', 'toString'])('treats inherited guide name %s as unknown', async section => {
  const options = setup();
  options.guideSections = { editing: 'Edit guide' };
  const read = answer('cad_script_guide');
  read.calls![0].arguments = { section };
  const replies = [read, { role: 'assistant' as const, text: 'Question: Which section?' }];
  options.request = vi.fn(async () => replies.shift()!);
  const result = await runDesignAssistant(options);
  expect(result.messages.find(message => message.role === 'tool')?.text).toBe('Unknown guide section. Available: editing');
});

it('counts a failed paid request as unknown usage before surfacing its error', async () => {
  const options = setup();
  options.onUsage = vi.fn();
  options.request = vi.fn(async () => {
    throw new Error('Provider request failed');
  });
  await expect(runDesignAssistant(options)).rejects.toThrow('Provider request failed');
  expect(options.onUsage).toHaveBeenCalledWith(expect.objectContaining({ calls: 1, inputTokens: null, costUsd: null }));
});

it('continues a dollar-capped compatible run without write counts when input pricing explicitly includes writes', async () => {
  const options = setup();
  options.limits = { maxCostUsd: 1 };
  options.pricing = { inputUsdPerMillion: 3, outputUsdPerMillion: 15, cacheWritesAtInputPrice: true };
  const replies = [answer('cad_script_guide'), { role: 'assistant' as const, text: 'Question: Which size?' }];
  options.request = vi.fn(async () => ({ ...replies.shift()!, usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0 } }));
  const result = await runDesignAssistant(options);
  expect(result.status).toBe('question');
  expect(result.usage.calls).toBe(2);
  expect(result.usage.costUsd).toBeCloseTo(0.0009);
});

it('keeps sectioned guides and suggested questions available before finalization', async () => {
  const options = setup();
  options.guideSections = { editing: 'Targeted edit instructions' };
  const read = answer('cad_script_guide');
  read.calls![0].arguments = { section: 'editing' };
  const question = answer('ask_user');
  question.calls![0].arguments = { question: 'Which thickness?', choices: ['18 mm', '24 mm'] };
  const replies = [read, question];
  options.request = vi.fn<NonNullable<AssistantRunOptions['request']>>(async request => {
    expect(request.tools.find(tool => tool.name === 'ask_user')).toBeDefined();
    expect(request.tools.find(tool => tool.name === 'cad_script_guide')?.parameters).toMatchObject({
      properties: { section: { type: 'string' } },
    });
    return replies.shift()!;
  });
  const result = await runDesignAssistant(options);
  expect(result.status).toBe('question');
  expect(result.messages.find(message => message.role === 'tool')?.text).toBe('Targeted edit instructions');
  expect(resumeAssistantMessages(result.messages)).toEqual(result.messages);
});

it('does not let suggested questions bypass the final response budget', async () => {
  const options = setup();
  options.maxTurns = 1;
  const question = answer('ask_user');
  question.calls![0].arguments = { question: 'Which thickness?', choices: ['18 mm', '24 mm'] };
  options.request = vi.fn(async request => {
    expect(request.tools).toEqual([]);
    return question;
  });
  const result = await runDesignAssistant(options);
  expect(result.status).toBe('exhausted');
  expect(result.stopReason).toContain('execution budget');
  expect(result.messages.at(-1)).toMatchObject({ role: 'tool', callId: question.calls![0].id });
  expect(options.request).toHaveBeenCalledTimes(1);
  expect(options.check).not.toHaveBeenCalled();
});
