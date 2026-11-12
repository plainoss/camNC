import { AssistantProviderError, requestAssistant, type AssistantImage, type ProviderConfig } from './provider';
import { connectionPreset } from './connectionPresets';
import { defaultImageModel, defaultTextModel, listProviderModels } from './modelDefaults';

export interface ConnectionTestResult {
  config: ProviderConfig;
  /** Plain-language findings, shown after a successful test. */
  notes: string[];
}

// A 1×1 white PNG: proves the model accepts images without sending design data.
const probeImage: AssistantImage = {
  name: 'connection-check.png',
  mediaType: 'image/png',
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
};
const tool = {
  name: 'connection_check',
  description: 'Confirms that tool calls work.',
  parameters: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
};

function explain(cause: unknown): string {
  if (cause instanceof AssistantProviderError) {
    if (cause.code === 'network')
      return 'The browser could not reach this provider. Check the address; some providers block requests from web pages (CORS).';
    if (cause.status === 401 || cause.status === 403) return 'The provider rejected this key, or the key cannot use this model.';
    if (cause.status === 404) return 'The provider does not know this model or address. Check the model ID.';
    return cause.message;
  }
  return cause instanceof Error ? cause.message : 'The connection test failed.';
}

/**
 * One tiny tool-calling request (well under a cent), retried once without the probe image when images are refused.
 * Nothing from the open design is sent.
 */
export async function testAssistantConnection(
  config: ProviderConfig,
  key: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch
): Promise<ConnectionTestResult> {
  const notes: string[] = [];
  // Blank model fields mean "choose for me": the provider's own list decides, so new models need no app update.
  const provider = connectionPreset(config).id;
  const wantsImageModel = provider !== 'anthropic' && config.imageModel === undefined;
  if (!config.model.trim() || wantsImageModel) {
    const available = await listProviderModels(config, key, signal, fetcher);
    const fallback = connectionPreset(config).models[0]?.id;
    const text = config.model.trim() || (available && defaultTextModel(provider, available)) || fallback;
    if (!text) throw new Error("This provider didn't list its models. Enter a model ID under Models.");
    const image = wantsImageModel && available ? defaultImageModel(provider, available) : config.imageModel;
    config = { ...config, model: text, ...(image ? { imageModel: image } : {}) };
    if (wantsImageModel && !image) {
      const { imageModel: _none, ...rest } = config;
      config = rest;
    }
  }
  const ask = async (images: boolean) =>
    requestAssistant(
      {
        config: { ...config, images },
        key,
        system: 'This is an automated connection check. Call connection_check with ok set to true.',
        messages: [{ role: 'user', text: 'Connection check.', ...(images && { images: [probeImage] }) }],
        tools: [tool],
        signal,
        maxOutputTokens: 64,
        timeoutMs: 30_000,
      },
      fetcher
    );
  let images = config.images;
  let reply;
  try {
    reply = await ask(images);
  } catch (cause) {
    const refusedImage = images && cause instanceof AssistantProviderError && cause.code === 'http' && cause.status === 400;
    if (!refusedImage) throw new Error(explain(cause));
    images = false;
    notes.push('This model does not accept images; reference pictures and view checks are off.');
    try {
      reply = await ask(false);
    } catch (retry) {
      throw new Error(explain(retry));
    }
  }
  if (!reply.calls?.some(call => call.name === tool.name))
    throw new Error('The model answered but did not call a tool. Choose a model that supports tool use.');
  return { config: { ...config, tools: true, images }, notes };
}
