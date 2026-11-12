import { createPlateDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { AssistantDock } from './Dock';
import { defaultProvider, rememberAssistantCredentials } from './keyStore';
import { requestAssistant } from './provider';
import { readConversation, recordAssistantEvent, writeConversation } from './conversationStore';
import { settled } from '@/test/settled';

vi.mock('./provider', { spy: true });
afterEach(() => {
  cleanup();
  rememberAssistantCredentials(null);
  vi.restoreAllMocks();
});

it('shows image-only history and preserves constraints when moving to a text-only provider', async () => {
  const document = createPlateDocument();
  writeConversation(document.id, [
    { role: 'user', text: 'No visible screws. Board is 18 mm.' },
    { role: 'user', text: '', images: [{ name: 'reference.png', mediaType: 'image/png', data: 'AA==' }] },
  ]);
  rememberAssistantCredentials({ config: { ...defaultProvider, model: 'recorded', images: false }, key: 'recorded-key' });
  vi.mocked(requestAssistant).mockImplementation(async request => {
    expect(request.messages[0].text).toBe('No visible screws. Board is 18 mm.');
    expect(request.messages.every(message => !message.images?.length)).toBe(true);
    expect(request.messages[1].text).toContain('selected provider is text-only');
    return { role: 'assistant', text: 'Question: What diameter?', usage: { inputTokens: 123, outputTokens: 12 } };
  });
  render(
    <AssistantDock
      proposal={null}
      onCheckedProposal={() => {}}
      onDiscardProposal={() => {}}
      document={document}
      onProposal={() => {}}
      onClose={() => {}}
    />
  );
  expect(screen.getByRole('img', { name: 'reference.png' })).toBeDefined();
  await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Cut a hole.');
  await userEvent.click(screen.getByRole('button', { name: 'Send' }));
  // The whole turn, real CAD context preparation included, before the reply.
  await settled();
  expect(requestAssistant).toHaveBeenCalledOnce();
  expect(screen.getByText('Question: What diameter?')).toBeDefined();
  await userEvent.click(screen.getByRole('button', { name: 'Assistant settings' }));
  await userEvent.click(screen.getByRole('button', { name: 'Cost and limits' }));
  expect(screen.getByLabelText('Last turn usage').textContent).toContain('input 123 tokens');
  expect(screen.getByLabelText('Last turn usage').textContent).toContain('cost unknown');
  expect(readConversation(document.id)[1].images).toHaveLength(1);
});

it('subscribes to external proposal outcomes without erasing earlier constraints', async () => {
  const document = createPlateDocument();
  rememberAssistantCredentials({ config: { ...defaultProvider, model: 'recorded' }, key: 'recorded-key' });
  writeConversation(document.id, [{ role: 'user', text: 'Keep the back 6 mm.' }]);
  render(
    <AssistantDock
      proposal={null}
      onCheckedProposal={() => {}}
      onDiscardProposal={() => {}}
      document={document}
      onProposal={() => {}}
      onClose={() => {}}
    />
  );
  recordAssistantEvent(document.id, 'The user discarded the proposal review.', 'discarded');
  await waitFor(() => expect(within(screen.getByRole('log')).getByText(/discarded the proposal/)).toBeDefined());
  expect(screen.getByText('Keep the back 6 mm.')).toBeDefined();
});
