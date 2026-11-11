import { describe, expect, it } from 'vitest';
import { assistantContextCharacters, buildAssistantContext } from './context';
import type { AssistantImage, AssistantMessage } from './provider';
import { assistantGuide } from './guide';
import originalGuide from '../../../../../packages/cad-script/README.md?raw';

const image = (name: string): AssistantImage => ({ name, mediaType: 'image/png', data: 'X'.repeat(200_000) });
const batch = (id: string, source: string, images?: AssistantImage[]): AssistantMessage[] => [
  {
    role: 'assistant',
    text: '',
    calls: [{ id, name: 'check_design', arguments: { source } }],
    responseItems: [
      { type: 'reasoning', id: `reason-${id}`, encrypted_content: source },
      { type: 'function_call', call_id: id, arguments: source },
    ],
  },
  { role: 'tool', callId: id, text: JSON.stringify({ ok: true }), images },
];

describe('bounded assistant provider context', () => {
  it('retains the current SVG candidate and its views through reports and full finalization', () => {
    const candidate = batch('svg', '<svg>current</svg>', [image('top')]);
    candidate[0]!.calls![0]!.name = 'check_svg';
    const messages: AssistantMessage[] = [
      ...candidate,
      { role: 'assistant', text: '', calls: [{ id: 'read', name: 'read_design_report', arguments: {} }] },
      { role: 'tool', callId: 'read', text: 'details' },
      { role: 'assistant', text: '', calls: [{ id: 'final', name: 'finalize_design', arguments: {} }] },
      { role: 'tool', callId: 'final', text: 'complete' },
    ];
    const result = buildAssistantContext(messages, { images: true });
    expect(result).toEqual(messages);
    expect(result.flatMap(message => message.images ?? []).map(image => image.name)).toEqual(['top']);
  });
  it('retains earlier suggested questions so short user replies keep their meaning', () => {
    const question: AssistantMessage = {
      role: 'assistant',
      text: '',
      calls: [{ id: 'ask', name: 'ask_user', arguments: { question: 'Keep the back 6 mm?', choices: ['Yes', 'No'] } }],
    };
    const messages: AssistantMessage[] = [
      question,
      { role: 'tool', callId: 'ask', text: 'Waiting for the user.' },
      { role: 'user', text: 'Yes' },
      ...batch('old', 'superseded'),
      ...batch('new', 'latest'),
    ];
    const result = buildAssistantContext(messages, { images: false });
    expect(result[0]).toEqual(question);
    expect(result[1]).toEqual(messages[1]);
    expect(result[2]).toEqual({ role: 'user', text: 'Yes' });
    expect(JSON.stringify(result)).not.toContain('superseded"');
  });
  it('preserves earlier constraints, decisions and application events while removing superseded scripts and raw reasoning', () => {
    const original: AssistantMessage[] = [
      { role: 'user', text: 'No visible screws. Board is 18 mm; back is 6 mm.' },
      ...batch('old', 'BULKY OLD SOURCE', [image('old-view')]),
      { role: 'assistant', text: 'Proposal: retain the 6 mm back.', responseItems: [{ type: 'message', text: 'duplicate final' }] },
      { role: 'user', text: '[Application context data: user applied proposal.]' },
      { role: 'user', text: 'Make this shelf wider.' },
      ...batch('new', 'latest source', [image('new-view')]),
    ];
    original[1]!.text = 'BULKY OLD SOURCE copied in tool narration';
    const result = buildAssistantContext(original, { images: true });
    expect(result[0]).toEqual(original[0]);
    expect(result.some(message => message.text === 'Proposal: retain the 6 mm back.')).toBe(true);
    expect(result.some(message => message.text.includes('user applied proposal'))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('BULKY OLD SOURCE');
    expect(JSON.stringify(result)).not.toContain('duplicate final');
    expect(result.find(message => message.calls)?.responseItems).toEqual(original.at(-2)?.responseItems);
    expect(result.filter(message => message.role === 'tool').map(message => message.callId)).toEqual(['new']);
    expect(original[1]!.calls![0]!.arguments.source).toBe('BULKY OLD SOURCE');
  });

  it('retains multi-call batches and Responses reasoning atomically', () => {
    const messages: AssistantMessage[] = [
      { role: 'user', text: 'Check it.' },
      {
        role: 'assistant',
        text: '',
        calls: [
          { id: 'a', name: 'check_design', arguments: { source: 'd => {}' } },
          { id: 'b', name: 'read_design', arguments: {} },
        ],
        responseItems: [{ type: 'reasoning', id: 'r' }],
      },
      { role: 'tool', callId: 'b', text: 'script' },
      { role: 'tool', callId: 'a', text: 'report' },
    ];
    expect(buildAssistantContext(messages, { images: true })).toEqual(messages);
    expect(() => buildAssistantContext(messages.slice(0, -1), { images: true })).toThrow('interrupted');
    expect(() => buildAssistantContext([{ role: 'tool', callId: 'a', text: 'orphan' }], { images: true })).toThrow('without its call');
  });

  it('keeps original references and only latest candidate images; projects text-only requests with an explicit notice', () => {
    const messages: AssistantMessage[] = [
      { role: 'user', text: '', images: [image('reference')] },
      ...batch('one', 'first', [image('first')]),
      ...batch('two', 'latest', [image('latest')]),
    ];
    const visual = buildAssistantContext(messages, { images: true });
    expect(visual.flatMap(message => message.images ?? []).map(item => item.name)).toEqual(['reference', 'latest']);
    const textOnly = buildAssistantContext(messages, { images: false });
    expect(textOnly.every(message => !message.images)).toBe(true);
    expect(textOnly[0]!.text).toContain('images unavailable in this request: reference');
    expect(textOnly[0]!.text).toContain('text-only');
  });

  it('refuses excess input without dropping a constraint, and excludes base64 from the textual ceiling', () => {
    const messages: AssistantMessage[] = [{ role: 'user', text: 'Keep every constraint. '.repeat(100), images: [image('reference')] }];
    expect(() => buildAssistantContext(messages, { images: true, maxCharacters: 100 })).toThrow('nothing was sent');
    expect(buildAssistantContext(messages, { images: true, maxCharacters: 5000 })).toEqual(messages);
    expect(assistantContextCharacters(messages)).toBeLessThan(5000);
  });

  it('keeps only the latest retrieval for each guide section and example', () => {
    const retrieval = (id: string, section: string): AssistantMessage[] => [
      { role: 'assistant', text: '', calls: [{ id, name: 'cad_script_guide', arguments: { section } }] },
      { role: 'tool', callId: id, text: `help ${id}` },
    ];
    const result = buildAssistantContext(
      [...retrieval('old', 'editing'), ...retrieval('other', 'assembly'), ...retrieval('latest', 'editing'), ...batch('check', 'script')],
      { images: true }
    );
    expect(result.filter(message => message.role === 'tool').map(message => message.callId)).toEqual(['other', 'latest', 'check']);
  });

  it('reduces a five-attempt repair context without losing constraints or the final candidate', () => {
    const constraint: AssistantMessage = { role: 'user', text: 'No visible screws. Keep the back 6 mm and all existing IDs.' };
    const scripts = Array.from(
      { length: 5 },
      (_, index) => `d => { /* attempt ${index}: ${'editable woodworking geometry; '.repeat(100)} */ }`
    );
    const history = (guide: string): AssistantMessage[] => [
      constraint,
      { role: 'assistant', text: '', calls: [{ id: 'guide', name: 'cad_script_guide', arguments: {} }] },
      { role: 'tool', callId: 'guide', text: guide },
      ...scripts.flatMap((source, index) => batch(String(index), source, [image(`view-${index}`)])),
    ];
    const original = history(originalGuide);
    const projected = buildAssistantContext(history(assistantGuide), { images: true });
    const ratio = assistantContextCharacters(projected) / assistantContextCharacters(original);
    expect(ratio).toBeLessThan(0.5);
    expect(projected[0]).toEqual(constraint);
    expect(projected.find(message => message.calls?.some(call => call.name === 'check_design'))?.calls?.[0].arguments.source).toBe(
      scripts[4]
    );
    expect(projected.flatMap(message => message.images ?? [])).toHaveLength(1);
  });
});
