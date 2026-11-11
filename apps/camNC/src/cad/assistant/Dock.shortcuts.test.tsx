import { createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '../../style.css';
import '../cad.css';
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
  rememberAssistantCredentials({ config: { ...defaultProvider, model: 'recorded', images: false }, key: 'recorded-key' });
  vi.mocked(runDesignAssistant).mockReset();
  vi.mocked(runDesignAssistant).mockResolvedValue({ status: 'question', messages: [], checks: 0, usage: createAssistantUsage() });
});
afterEach(() => {
  cleanup();
  rememberAssistantCredentials(null);
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function composer() {
  render(
    <div className="cad-editor" style={{ position: 'relative', height: 780, width: 1000 }}>
      <AssistantDock
        proposal={null}
        onCheckedProposal={() => {}}
        onDiscardProposal={() => {}}
        document={createPlateDocument()}
        onProposal={vi.fn()}
        onClose={vi.fn()}
      />
    </div>
  );
  return screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message' });
}

it.each(['Control', 'Meta'])('sends the exact draft once with %s+Enter', async modifier => {
  const input = composer();
  const draft = 'Make the shelf 24 mm thick.';
  await userEvent.type(input, draft);
  await userEvent.keyboard(`{${modifier}>}{Enter}{/${modifier}}`);
  await waitFor(() => expect(runDesignAssistant).toHaveBeenCalledOnce());
  expect(vi.mocked(runDesignAssistant).mock.calls[0][0].messages.at(-1)).toEqual({ role: 'user', text: draft });
  await waitFor(() => expect(input.disabled).toBe(false));
  expect(input.value).toBe('');
});

it('keeps Enter and Shift+Enter as newlines without sending', async () => {
  const input = composer();
  await userEvent.type(input, 'First line');
  await userEvent.keyboard('{Enter}Second line{Shift>}{Enter}{/Shift}Third line');
  expect(input.value).toBe('First line\nSecond line\nThird line');
  expect(runDesignAssistant).not.toHaveBeenCalled();
});

it.each([{ repeat: true }, { isComposing: true }, { keyCode: 229 }, { shiftKey: true }])(
  'ignores a submit shortcut with %j',
  async extra => {
    const input = composer();
    await userEvent.type(input, 'A draft still being edited');
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, ...extra });
    expect(runDesignAssistant).not.toHaveBeenCalled();
    expect(input.value).toBe('A draft still being edited');
  }
);

it('does not submit an empty draft through the shortcut', () => {
  const input = composer();
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
  fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
  expect(runDesignAssistant).not.toHaveBeenCalled();
});

it('does not start another turn while a submitted turn is pending', async () => {
  vi.mocked(runDesignAssistant).mockImplementationOnce(
    options =>
      new Promise(resolve => {
        options.signal.addEventListener(
          'abort',
          () => resolve({ status: 'stopped', messages: [], checks: 0, usage: createAssistantUsage() }),
          { once: true }
        );
      })
  );
  const input = composer();
  await userEvent.type(input, 'Review the current design.');
  await userEvent.keyboard('{Control>}{Enter}{/Control}');
  await waitFor(() => expect(runDesignAssistant).toHaveBeenCalledOnce());
  expect(input.disabled).toBe(true);
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
  fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
  expect(runDesignAssistant).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
  await waitFor(() => expect(input.disabled).toBe(false));
});

it('keeps the Send CTA colored under late editor button styles and advertises the shortcut', async () => {
  const input = composer();
  await userEvent.type(input, 'Review the design.');
  const generic = document.createElement('style');
  generic.textContent = '.cad-editor button { color: inherit; background: transparent; border: 1px solid transparent; }';
  document.head.append(generic);
  try {
    const send = screen.getByRole('button', { name: 'Send' });
    await userEvent.hover(input);
    const style = getComputedStyle(send);
    await waitFor(() => expect(style.backgroundColor).toBe('rgb(23, 108, 97)'));
    expect(style.color).toBe('rgb(255, 255, 255)');
    expect(input.getAttribute('aria-keyshortcuts')).toBe('Control+Enter Meta+Enter');
    expect(screen.getByText('⌘ / Ctrl + Enter to send')).toBeDefined();
  } finally {
    generic.remove();
  }
});
