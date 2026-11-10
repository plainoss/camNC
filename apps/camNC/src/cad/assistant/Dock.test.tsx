import { createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { page, userEvent } from '@vitest/browser/context';
import '../../style.css';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AssistantDock } from './Dock';
import { defaultProvider, rememberAssistantCredentials } from './keyStore';
import { runDesignAssistant } from './loop';
import { createAssistantUsage } from './runBudget';

vi.mock('@wbcnc/cad-script', async importOriginal => ({
  ...(await importOriginal<typeof import('@wbcnc/cad-script')>()),
  inspectCadDocument: vi.fn(async (document: CadDocument) => ({ document, report: {}, parts: [] })),
  compactCadReport: vi.fn(() => ({})),
  renderCadViews: vi.fn(() => []),
}));
vi.mock('./loop', async importOriginal => ({
  ...(await importOriginal<typeof import('./loop')>()),
  runDesignAssistant: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(runDesignAssistant).mockReset();
  rememberAssistantCredentials({ config: { ...defaultProvider, model: 'recorded', images: true }, key: 'recorded-key' });
  vi.mocked(runDesignAssistant).mockResolvedValue({ status: 'question', messages: [], checks: 0, usage: createAssistantUsage() });
});
afterEach(() => {
  cleanup();
  rememberAssistantCredentials(null);
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function dock() {
  const onProposal = vi.fn();
  const view = render(<AssistantDock document={createPlateDocument()} onProposal={onProposal} onClose={() => {}} />);
  return { ...view, onProposal };
}

it('prepares an editable starter without sending it or changing the design', async () => {
  const { onProposal } = dock();
  await userEvent.click(screen.getByRole('button', { name: /Build a cupboard/ }));
  const composer = screen.getByRole('textbox', { name: 'Message' });
  expect(composer).toHaveProperty('value', 'Help me design a cupboard. Ask me about dimensions, shelves and joinery before building.');
  expect(document.activeElement).toBe(composer);
  expect(runDesignAssistant).not.toHaveBeenCalled();
  expect(onProposal).not.toHaveBeenCalled();
});

it('sends the exact suggested reply and removes answered choices during the next turn', async () => {
  vi.mocked(runDesignAssistant).mockImplementationOnce(async options => {
    options.onMessage?.({
      role: 'assistant',
      text: 'Let us choose the material thickness first.',
      calls: [{ id: 'ask-1', name: 'ask_user', arguments: { question: 'Which thickness?', choices: ['18 mm', '24 mm'] } }],
    });
    options.onMessage?.({ role: 'tool', callId: 'ask-1', text: 'Waiting for the user to choose or type a reply.' });
    return { status: 'question', messages: [], checks: 0, usage: createAssistantUsage() };
  });
  let finish: (() => void) | undefined;
  vi.mocked(runDesignAssistant).mockImplementationOnce(
    options =>
      new Promise(resolve => {
        finish = () => {
          options.onMessage?.({ role: 'assistant', text: 'Question: how wide should it be?' });
          resolve({ status: 'question', messages: [], checks: 0, usage: createAssistantUsage() });
        };
      })
  );
  const { onProposal } = dock();
  await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Help me choose a thickness.');
  await userEvent.click(screen.getByRole('button', { name: 'Send' }));
  const reply = await screen.findByRole('button', { name: '24 mm' });
  expect(screen.getByText('Which thickness?')).toBeDefined();
  await waitFor(() => expect(reply).toHaveProperty('disabled', false));
  await userEvent.click(reply);
  await waitFor(() => expect(runDesignAssistant).toHaveBeenCalledTimes(2));
  expect(vi.mocked(runDesignAssistant).mock.calls[1][0].messages.at(-1)).toEqual({ role: 'user', text: '24 mm' });
  expect(screen.queryByRole('group', { name: 'Suggested replies' })).toBeNull();
  finish!();
  await screen.findByText('Question: how wide should it be?');
  expect(screen.queryByRole('group', { name: 'Suggested replies' })).toBeNull();
  expect(onProposal).not.toHaveBeenCalled();
});

it('opens the hidden image picker from the attachment action', async () => {
  dock();
  const picker = screen.getByLabelText<HTMLInputElement>('Reference image');
  const click = vi.spyOn(picker, 'click').mockImplementation(() => {});
  await userEvent.click(screen.getByRole('button', { name: 'Add reference image' }));
  expect(click).toHaveBeenCalledOnce();
  expect(picker.hidden).toBe(true);
  click.mockRestore();
});

it('disables attachments when the selected model has no image support', () => {
  rememberAssistantCredentials({ config: { ...defaultProvider, model: 'text-only', images: false }, key: 'recorded-key' });
  dock();
  expect(screen.getByRole('button', { name: 'Add reference image' })).toHaveProperty('disabled', true);
  expect(screen.getByLabelText('Reference image')).toHaveProperty('disabled', true);
  expect(screen.getByText('Enable image support in Connection to attach a reference.')).toBeDefined();
});

it('keeps the fresh greeting at the top and the composer visible beside expanded activity on mobile', async () => {
  const original = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(1100, 850);
  vi.mocked(runDesignAssistant).mockImplementationOnce(async options => {
    options.onMessage?.({ role: 'assistant', text: '', calls: [{ id: 'guide-layout', name: 'cad_script_guide', arguments: {} }] });
    options.onMessage?.({
      role: 'tool',
      callId: 'guide-layout',
      text: 'Woodworking design guide loaded. Keep existing parts and preview all changes.',
    });
    options.onMessage?.({
      role: 'assistant',
      text: '',
      calls: [
        {
          id: 'question-layout',
          name: 'ask_user',
          arguments: {
            question: 'How should we build the cupboard?',
            choices: ['Plywood with dados', 'Solid wood with dowels', 'Help me choose'],
          },
        },
      ],
    });
    options.onMessage?.({ role: 'tool', callId: 'question-layout', text: 'Waiting for your reply.' });
    return { status: 'question', messages: [], checks: 0, usage: createAssistantUsage() };
  });
  try {
    render(
      <div
        className="cad-editor"
        style={{
          position: 'relative',
          width: 'min(1000px, 100vw)',
          height: 'calc(100vh - 24px)',
          background: '#e9edeb',
          containerType: 'inline-size',
          containerName: 'cad-editor',
        }}>
        <AssistantDock document={createPlateDocument()} onProposal={() => {}} onClose={() => {}} />
      </div>
    );
    const conversation = screen.getByRole('log', { name: 'Conversation' });
    const panel = screen.getByRole('complementary', { name: 'Design assistant' });
    const greeting = screen.getByRole('heading', { name: 'What shall we make?' });
    expect(conversation.scrollTop).toBe(0);
    expect(greeting.getBoundingClientRect().top).toBeGreaterThanOrEqual(conversation.getBoundingClientRect().top);
    await userEvent.click(screen.getByRole('button', { name: /Build a cupboard/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Plywood with dados' })).toHaveProperty('disabled', false));
    await userEvent.click(screen.getByText('Agent activity'));
    await page.viewport(390, 844);
    const send = screen.getByRole('button', { name: 'Send' }).getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    expect(send.top).toBeGreaterThanOrEqual(bounds.top);
    expect(send.bottom).toBeLessThanOrEqual(bounds.bottom);
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
  } finally {
    await page.viewport(original.width, original.height);
  }
}, 30000);
