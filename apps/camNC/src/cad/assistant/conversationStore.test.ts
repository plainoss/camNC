import { expect, it, vi } from 'vitest';
import { appendConversation, readConversation, recordAssistantEvent, subscribeConversation, writeConversation } from './conversationStore';

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
