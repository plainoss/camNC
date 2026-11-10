import type { AssistantMessage } from './provider';

export interface AssistantContextOptions {
  images: boolean;
  /** Textual payload ceiling, not a token estimate; image bytes are limited separately. */
  maxCharacters?: number;
}

type Batch = { start: number; end: number; message: AssistantMessage };

/** Images have a separate byte/dimension budget; base64 length is not a text-token estimate. */
export function assistantContextCharacters(messages: readonly AssistantMessage[]): number {
  return JSON.stringify(
    messages.map(message => ({
      ...message,
      ...(message.images && { images: message.images.map(({ data: _data, ...metadata }) => metadata) }),
    }))
  ).length;
}

/** Compact the provider copy only. Never silently discard a user's earlier constraints. */
export function buildAssistantContext(messages: readonly AssistantMessage[], options: AssistantContextOptions): AssistantMessage[] {
  const limit = options.maxCharacters ?? 120_000;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Assistant context limit must be a positive integer.');
  const batches: Batch[] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;
    if (message.role === 'tool') throw new Error('Assistant context contains a tool result without its call.');
    if (!message.calls?.length) continue;
    const pending = new Set(message.calls.map(call => call.id));
    if (pending.size !== message.calls.length) throw new Error('Assistant context contains duplicate tool call IDs.');
    const start = index;
    while (messages[index + 1]?.role === 'tool') {
      const result = messages[++index]!;
      if (!result.callId || !pending.delete(result.callId)) throw new Error('Assistant context contains an unmatched tool result.');
    }
    // Trimming half of a batch breaks all three provider protocols, including Responses reasoning replay.
    if (pending.size) throw new Error('Assistant context contains an interrupted tool call. Resume the conversation before sending.');
    batches.push({ start, end: index, message });
  }

  const retained = new Set<number>();
  const latestReference = new Map<string, number>();
  let latestCheck = -1;
  for (const batch of batches) {
    for (const call of batch.message.calls!) {
      // A short reply such as "Yes" only makes sense with its earlier suggested question and choices.
      if (call.name === 'ask_user') retained.add(batch.start);
      if (call.name === 'check_design') latestCheck = batch.start;
      if (call.name === 'cad_script_guide' || call.name === 'cad_script_example')
        latestReference.set(`${call.name}:${String(call.arguments.section ?? call.arguments.name ?? '')}`, batch.start);
    }
  }
  for (const index of latestReference.values()) retained.add(index);
  const tailStart = latestCheck >= 0 ? latestCheck : (batches.at(-1)?.start ?? messages.length);
  for (const batch of batches) if (batch.start >= tailStart) retained.add(batch.start);

  let latestImages = -1;
  for (let index = 0; index < messages.length; index++)
    if (messages[index]!.role === 'tool' && messages[index]!.images?.length) latestImages = index;
  const result: AssistantMessage[] = [];
  const byStart = new Map(batches.map(batch => [batch.start, batch]));
  for (let index = 0; index < messages.length; index++) {
    const batch = byStart.get(index);
    if (batch && !retained.has(index)) {
      // Tool-call narration can repeat the entire generated script. Final assistant decisions are separate messages below.
      result.push({
        role: 'user',
        text: `[Application context data: superseded tool batch omitted: ${batch.message.calls!.map(call => call.name).join(', ')}. Its script/report is historical; no apply outcome is implied.]`,
      });
      index = batch.end;
      continue;
    }
    const message = structuredClone(messages[index]!);
    // Standalone assistant text is enough; raw Responses items would duplicate historical text/reasoning.
    if (message.role === 'assistant' && !message.calls?.length) delete message.responseItems;
    if (message.images?.length && (!options.images || (message.role === 'tool' && index !== latestImages))) {
      const names = message.images.map(image => image.name).join(', ');
      message.text += `\n[Application context data: images unavailable in this request: ${names}. ${options.images ? 'Superseded candidate views were omitted.' : 'The selected provider is text-only; ask for an image-capable provider when visual evidence is required.'}]`;
      delete message.images;
    }
    result.push(message);
  }
  if (assistantContextCharacters(result) > limit)
    throw new Error(
      'Assistant context exceeds the input limit. Start a new conversation and restate the constraints you want to keep; nothing was sent.'
    );
  return result;
}
