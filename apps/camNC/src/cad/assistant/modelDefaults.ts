import type { AssistantCredentials } from './keyStore';
import { providerUrl, type ProviderConfig } from './provider';
import type { ConnectionPresetId } from './connectionPresets';

/** Which provider a pasted key belongs to, from its published prefix. Anything else needs a choice. */
export function detectKeyProvider(key: string): ConnectionPresetId | null {
  const value = key.trim();
  if (value.startsWith('sk-ant-')) return 'anthropic';
  if (value.startsWith('sk-')) return 'openai';
  return null;
}

/** Numbers in a model ID, compared left to right, so claude-sonnet-5-5 > claude-sonnet-5 and gpt-image-2 > gpt-image-1. */
function version(id: string): number[] {
  return (id.match(/\d+(?:\.\d+)?/g) ?? []).flatMap(part => part.split('.').map(Number));
}
function newest(ids: string[]): string | undefined {
  return [...ids].sort((a, b) => {
    const x = version(a),
      y = version(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? -1) !== (y[i] ?? -1)) return (y[i] ?? -1) - (x[i] ?? -1);
    return a.length - b.length;
  })[0];
}

// Specialised or reduced variants are never the default; a person can still choose one under Models.
const kNotDefault = /(mini|nano|image|audio|realtime|tts|transcribe|search|instruct|codex|embedding|moderation|preview|oss|chat-latest)/;

/** The model the assistants use unless the person picks another: the provider's newest general model of its main line. */
export function defaultTextModel(provider: ConnectionPresetId, available: string[]): string | undefined {
  if (provider === 'anthropic')
    return newest(available.filter(id => /^claude-sonnet-\d/.test(id))) ?? newest(available.filter(id => /^claude-/.test(id)));
  return newest(available.filter(id => /^gpt-\d/.test(id) && !kNotDefault.test(id)));
}

/** The image model Carve uses with the same key; none for providers without image generation. */
export function defaultImageModel(provider: ConnectionPresetId, available: string[]): string | undefined {
  if (provider === 'anthropic') return undefined;
  return newest(available.filter(id => /^gpt-image-\d/.test(id) && !/mini/.test(id))) ?? available.find(id => id === 'dall-e-3');
}

/** The provider's own model list, with the same key. Returns null when the endpoint has none or refuses the browser. */
export async function listProviderModels(
  config: ProviderConfig,
  key: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch
): Promise<string[] | null> {
  const base = providerUrl(config).replace(/\/(messages|responses|chat\/completions)$/, '');
  try {
    const response = await fetcher(`${base}/models${config.kind === 'anthropic' ? '?limit=1000' : ''}`, {
      method: 'GET',
      credentials: 'omit',
      redirect: 'error',
      signal,
      headers:
        config.kind === 'anthropic'
          ? { 'x-api-key': key, 'anthropic-version': '2026-10-21', 'anthropic-dangerous-direct-browser-access': 'true' }
          : { authorization: `Bearer ${key}` },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: { id?: unknown }[] };
    const ids = (body.data ?? []).map(item => item.id).filter((id): id is string => typeof id === 'string' && id.length <= 200);
    return ids.length ? ids : null;
  } catch {
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
    return null;
  }
}

/**
 * Image generation with the connected provider and key, for Carve. Null when the connection has no image model: Carve
 * then offers text SVG only. The key is only ever sent to the same provider endpoint it was entered for.
 */
export function nativeImageFromConnection(
  credentials: AssistantCredentials | null,
  quality: 'low' | 'medium' | 'high' = 'low'
): { endpoint: string; model: string; key: string; quality: 'low' | 'medium' | 'high' } | null {
  const model = credentials?.config.imageModel?.trim();
  if (!credentials || !model || credentials.config.kind === 'anthropic') return null;
  return { endpoint: credentials.config.endpoint, model, key: credentials.key, quality };
}
