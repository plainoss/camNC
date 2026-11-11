import { providerMetadata } from './providerMetadata';
import { anthropicCachedSystem } from './anthropicCache';

export type ProviderKind = 'anthropic' | 'compatible';
export interface ProviderConfig {
  kind: ProviderKind;
  endpoint: string;
  model: string;
  protocol: 'chat' | 'responses';
  tools: boolean;
  images: boolean;
  /** Anthropic prompt caching is on by default; disable for endpoints that do not implement it. */
  promptCaching?: boolean;
}
export interface AssistantImage {
  name: string;
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  data: string;
}
export interface AssistantToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /** Provider data that must be replayed with the call, such as Gemini's extra_content thought signature. */
  extraContent?: unknown;
}
/** Totals include cached input and reasoning output; breakdowns are subsets, never additional tokens. */
export interface AssistantUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}
export interface AssistantMessage {
  role: 'user' | 'assistant' | 'tool';
  /** Application-authored design lifecycle event rather than a user request. */
  event?: boolean;
  proposalOutcome?: 'applied' | 'discarded';
  usage?: AssistantUsage;
  completion?: 'complete' | 'incomplete' | 'refused';
  latencyMs?: number;
  text: string;
  images?: AssistantImage[];
  calls?: AssistantToolCall[];
  callId?: string;
  /** Responses reasoning items must accompany their function calls on the next request. */
  responseItems?: unknown[];
  /** Preserve signed Anthropic thinking blocks with their complete tool-call batch. */
  anthropicContent?: unknown[];
}
export interface AssistantTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface ProviderRequest {
  config: ProviderConfig;
  key: string;
  system: string;
  messages: AssistantMessage[];
  tools: AssistantTool[];
  signal: AbortSignal;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export function providerUrl(config: ProviderConfig): string {
  const url = new URL(config.endpoint);
  if (url.username || url.password || url.search || url.hash) throw new Error('Use an API address without credentials, query or fragment.');
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('Use HTTPS, or a local provider on localhost.');
  return `${url.href.replace(/\/$/, '')}/${config.kind === 'anthropic' ? 'messages' : config.protocol === 'responses' ? 'responses' : 'chat/completions'}`;
}

const imageUrl = (image: AssistantImage) => `data:${image.mediaType};base64,${image.data}`;
const anthropicImage = (image: AssistantImage) => ({
  type: 'image',
  source: { type: 'base64', media_type: image.mediaType, data: image.data },
});
const textBlock = (text: string) => ({ type: 'text', text });

/** Image context is a user turn in compatible APIs, so it follows the entire tool-result batch. */
function compatibleMessages(messages: AssistantMessage[]): AssistantMessage[] {
  const result: AssistantMessage[] = [],
    images: AssistantImage[] = [];
  const pending = new Set<string>();
  for (const message of messages) {
    if (message.role === 'assistant') for (const call of message.calls ?? []) pending.add(call.id);
    if (message.role === 'tool') {
      const { images: views, ...tool } = message;
      result.push(tool);
      images.push(...(views ?? []));
      if (message.callId) pending.delete(message.callId);
      if (!pending.size && images.length)
        result.push({ role: 'user', text: 'Views of the checked candidate for visual inspection:', images: images.splice(0) });
    } else result.push(message);
  }
  return result;
}

export function providerPayload({
  config,
  system,
  messages,
  tools,
  maxOutputTokens = 8192,
}: Omit<ProviderRequest, 'key' | 'signal'>): Record<string, unknown> {
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1) throw new Error('Choose a positive output token limit.');
  if (!config.tools) throw new Error('Select a model that supports tools.');
  if (!config.model.trim()) throw new Error('Enter the model ID from your provider.');
  if (!config.images && messages.some(message => message.images?.length))
    throw new Error('This model is marked as text-only. Select an image-capable model or remove the images.');
  if (config.kind === 'anthropic') {
    const turns: { role: string; content: unknown[] }[] = [];
    for (const message of messages) {
      const role = message.role === 'assistant' ? 'assistant' : 'user';
      const content =
        message.role === 'assistant' && message.anthropicContent
          ? message.anthropicContent
          : message.role === 'tool'
            ? [
                {
                  type: 'tool_result',
                  tool_use_id: message.callId,
                  content: [textBlock(message.text), ...(message.images ?? []).map(anthropicImage)],
                },
              ]
            : [
                ...(message.text ? [textBlock(message.text)] : []),
                ...(message.images ?? []).map(anthropicImage),
                ...(message.calls ?? []).map(call => ({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments })),
              ];
      const previous = turns.at(-1);
      if (previous?.role === role) previous.content.push(...content);
      else turns.push({ role, content });
    }
    return {
      model: config.model,
      system: config.promptCaching === false ? system : anthropicCachedSystem(system),
      ...(config.promptCaching !== false && { cache_control: { type: 'ephemeral' } }),
      max_tokens: maxOutputTokens,
      messages: turns,
      tools: tools.map((tool, index) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
        ...(config.promptCaching !== false && index === tools.length - 1 && { cache_control: { type: 'ephemeral' } }),
      })),
    };
  }
  if (config.protocol === 'responses') {
    const input = compatibleMessages(messages).flatMap((message): unknown[] => {
      if (message.role === 'assistant' && message.responseItems) return message.responseItems;
      if (message.role === 'tool')
        return [
          { type: 'function_call_output', call_id: message.callId, output: message.text },
          ...(message.images?.length
            ? [
                {
                  role: 'user',
                  content: [
                    { type: 'input_text', text: 'Views of the checked candidate for visual inspection:' },
                    ...message.images.map(image => ({ type: 'input_image', image_url: imageUrl(image) })),
                  ],
                },
              ]
            : []),
        ];
      return [
        {
          role: message.role,
          content: [
            { type: message.role === 'assistant' ? 'output_text' : 'input_text', text: message.text },
            ...(message.images ?? []).map(image => ({ type: 'input_image', image_url: imageUrl(image) })),
          ],
        },
        ...(message.calls ?? []).map(call => ({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: JSON.stringify(call.arguments),
        })),
      ];
    });
    return {
      model: config.model,
      instructions: system,
      max_output_tokens: maxOutputTokens,
      input,
      store: false,
      tools: tools.map(tool => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        strict: false,
      })),
    };
  }
  const turns = compatibleMessages(messages).flatMap((message): unknown[] => {
    if (message.role === 'tool')
      return [
        { role: 'tool', tool_call_id: message.callId, content: message.text },
        ...(message.images?.length
          ? [
              {
                role: 'user',
                content: [
                  textBlock('Views of the checked candidate:'),
                  ...message.images.map(image => ({ type: 'image_url', image_url: { url: imageUrl(image) } })),
                ],
              },
            ]
          : []),
      ];
    return [
      {
        role: message.role,
        content: message.images?.length
          ? [textBlock(message.text), ...message.images.map(image => ({ type: 'image_url', image_url: { url: imageUrl(image) } }))]
          : message.text,
        ...(message.calls?.length && {
          tool_calls: message.calls.map(call => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
            ...(call.extraContent !== undefined && { extra_content: call.extraContent }),
          })),
        }),
      },
    ];
  });
  return {
    model: config.model,
    messages: [{ role: 'system', content: system }, ...turns],
    max_completion_tokens: maxOutputTokens,
    tools: tools.map(tool => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    })),
  };
}

function argumentsObject(input: unknown): Record<string, unknown> {
  const value: unknown = typeof input === 'string' ? JSON.parse(input) : input;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The provider returned invalid tool arguments.');
  return value as Record<string, unknown>;
}

function toolCall(id: unknown, name: unknown, input: unknown): AssistantToolCall {
  if (typeof id !== 'string' || !id.trim() || typeof name !== 'string' || !name.trim())
    throw new Error('The provider returned an invalid tool call ID or name.');
  return { id, name, arguments: argumentsObject(input) };
}

export function parseProviderMessage(config: ProviderConfig, input: unknown): AssistantMessage {
  const metadata = providerMetadata(config, input);
  const interrupted = metadata.completion === 'incomplete' || metadata.completion === 'refused';
  const data = input as {
    content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[];
    choices?: {
      message?: { content?: string; tool_calls?: { id: string; function: { name: string; arguments: string }; extra_content?: unknown }[] };
    }[];
    output?: { type: string; call_id?: string; name?: string; arguments?: string; content?: { text?: string }[] }[];
  };
  if (config.kind === 'anthropic') {
    if (!Array.isArray(data.content)) throw new Error('The provider returned no message.');
    return {
      role: 'assistant',
      ...metadata,
      text: data.content
        .filter(block => block.type === 'text')
        .map(block => block.text ?? '')
        .join('\n'),
      calls: interrupted
        ? []
        : data.content.filter(block => block.type === 'tool_use').map(block => toolCall(block.id, block.name, block.input)),
      ...(!interrupted && { anthropicContent: data.content }),
    };
  }
  if (config.protocol === 'responses') {
    if (!Array.isArray(data.output)) throw new Error('The provider returned no message.');
    return {
      role: 'assistant',
      ...metadata,
      text: data.output
        .filter(item => item.type === 'message')
        .flatMap(item => item.content ?? [])
        .map(item => item.text ?? '')
        .join('\n'),
      calls: interrupted
        ? []
        : data.output.filter(item => item.type === 'function_call').map(item => toolCall(item.call_id, item.name, item.arguments)),
      responseItems: data.output,
    };
  }
  const message = data.choices?.[0]?.message;
  if (!message) throw new Error('The provider returned no message.');
  return {
    role: 'assistant',
    ...metadata,
    text: message.content ?? '',
    calls: interrupted
      ? []
      : message.tool_calls?.map(call => ({
          ...toolCall(call.id, call.function.name, call.function.arguments),
          ...(call.extra_content !== undefined && { extraContent: call.extra_content }),
        })),
  };
}

export class AssistantProviderError extends Error {
  constructor(
    readonly code: 'timeout' | 'network' | 'http' | 'protocol',
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'AssistantProviderError';
  }
}

/** Browser → chosen provider only. Error bodies can echo credentials, so they never enter chat or logs. */
export async function requestAssistant(request: ProviderRequest, fetcher: typeof fetch = fetch): Promise<AssistantMessage> {
  const url = providerUrl(request.config);
  const payload = providerPayload(request);
  const timeoutMs = request.timeoutMs ?? 90_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('Choose a positive provider timeout.');
  if (request.signal.aborted) throw new DOMException('Stopped', 'AbortError');
  const controller = new AbortController();
  const started = performance.now();
  let abort: () => void = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => {
      controller.abort();
      reject(new DOMException('Stopped', 'AbortError'));
    };
    request.signal.addEventListener('abort', abort, { once: true });
    // Race the complete operation: a provider can return headers and then stall its JSON body.
    timer = setTimeout(() => {
      controller.abort();
      reject(new AssistantProviderError('timeout', 'The provider took too long. Try again or choose a faster model.'));
    }, timeoutMs);
  });
  const operation = async (): Promise<AssistantMessage> => {
    let response: Response;
    try {
      response = await fetcher(url, {
        method: 'POST',
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(request.config.kind === 'anthropic'
            ? { 'x-api-key': request.key, 'anthropic-version': '2026-10-21', 'anthropic-dangerous-direct-browser-access': 'true' }
            : { authorization: `Bearer ${request.key}` }),
        },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new AssistantProviderError(
        'network',
        'Could not reach this provider from the browser. Check its address and browser access (CORS).'
      );
    }
    if (!response.ok) {
      const action =
        response.status === 429
          ? 'Wait before trying again, or check your provider quota.'
          : response.status === 401 || response.status === 403
            ? 'Check your key and model permissions.'
            : 'Check your model and API protocol, or try again later.';
      throw new AssistantProviderError('http', `Provider request failed (HTTP ${response.status}). ${action}`, response.status);
    }
    try {
      const message = parseProviderMessage(request.config, await response.json());
      return { ...message, latencyMs: performance.now() - started };
    } catch {
      throw new AssistantProviderError(
        'protocol',
        'The provider returned an unsupported response. Check its API protocol and tool support.'
      );
    }
  };
  try {
    return await Promise.race([interrupted, operation()]);
  } finally {
    if (timer) clearTimeout(timer);
    request.signal.removeEventListener('abort', abort);
  }
}
