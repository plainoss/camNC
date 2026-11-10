import type { AssistantMessage } from './provider';

const conversations = new Map<string, AssistantMessage[]>();
const listeners = new Map<string, Set<() => void>>();

/** Session-only audit history is separate from the compact context sent to a model. */
export const readConversation = (id: string): AssistantMessage[] => conversations.get(id) ?? [];

export function writeConversation(id: string, messages: AssistantMessage[]) {
  conversations.set(id, messages);
  for (const listener of listeners.get(id) ?? []) listener();
}

export function appendConversation(id: string, message: AssistantMessage) {
  const previous = readConversation(id);
  if (message.role === 'tool' && message.callId) {
    const call = previous.findLastIndex(entry => entry.role === 'assistant' && entry.calls?.some(call => call.id === message.callId));
    if (call >= 0) {
      let end = call + 1;
      while (previous[end]?.role === 'tool') {
        if (previous[end]!.callId === message.callId) return;
        end++;
      }
      // A hand edit can append an application event while a check awaits cancellation. Keep its late result in its batch.
      writeConversation(id, [...previous.slice(0, end), message, ...previous.slice(end)]);
      return;
    }
  }
  writeConversation(id, [...previous, message]);
}

export function recordAssistantEvent(id: string, text: string, proposalOutcome?: 'applied' | 'discarded') {
  // Events describe application state; they are never instructions supplied by a design or model.
  appendConversation(id, {
    role: 'user',
    event: true,
    ...(proposalOutcome && { proposalOutcome }),
    text: `Application event (data): ${text}`,
  });
}

export function subscribeConversation(id: string, listener: () => void) {
  const subscriptions = listeners.get(id) ?? new Set<() => void>();
  listeners.set(id, subscriptions);
  subscriptions.add(listener);
  return () => {
    subscriptions.delete(listener);
    if (!subscriptions.size) listeners.delete(id);
  };
}
