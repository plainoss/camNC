import { expect, it, vi } from 'vitest';
import { appendConversation, readConversation, recordAssistantEvent, subscribeConversation, writeConversation } from './conversationStore';
import { buildAssistantContext } from './context';
import { resumeAssistantMessages } from './loop';

it('retains proposal outcomes while the dock is closed and isolates documents', () => {
  const id = crypto.randomUUID();
  const listener = vi.fn();
  const unsubscribe = subscribeConversation(id, listener);
  appendConversation(id, { role: 'user', text: 'No visible screws.' });
  recordAssistantEvent(id, 'Proposal applied as one undo step.');
  expect(readConversation(id)).toMatchObject([
    { text: 'No visible screws.' },
    { role: 'user', event: true, text: expect.stringContaining('applied') },
  ]);
  expect(readConversation(crypto.randomUUID())).toEqual([]);
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe();
  writeConversation(id, []);
  expect(listener).toHaveBeenCalledTimes(2);
});

it('keeps late cancelled results in their batch ahead of intervening design events', () => {
  const id = crypto.randomUUID();
  appendConversation(id, {
    role: 'assistant',
    text: '',
    calls: [
      { id: 'check', name: 'check_design', arguments: { source: 'd => {}' } },
      { id: 'guide', name: 'cad_script_guide', arguments: {} },
    ],
  });
  recordAssistantEvent(id, 'The open design changed.');
  appendConversation(id, { role: 'tool', callId: 'check', text: 'Stopped.' });
  appendConversation(id, { role: 'tool', callId: 'guide', text: 'Not run.' });
  appendConversation(id, { role: 'tool', callId: 'check', text: 'Duplicate late response.' });
  const messages = readConversation(id);
  expect(messages.map(message => message.role)).toEqual(['assistant', 'tool', 'tool', 'user']);
  expect(resumeAssistantMessages(messages)).toEqual(messages);
  expect(() => buildAssistantContext(messages, { images: false })).not.toThrow();
});
