import { providerUrl, type ProviderRequest } from '@/cad/assistant/provider';

export interface NativeImageConfig {
  endpoint: string;
  model: string;
  /** Separate explicit credential: never forward a text provider's key to a different image provider. */
  key: string;
  quality: 'low' | 'medium' | 'high';
}

/** Image models receive art direction only. Physical dimensions and tool limits belong to local preparation. */
export function buildRasterArtPrompt(subject: string, detail: 'simple' | 'balanced' | 'detailed'): string {
  const level = { simple: 'Low', balanced: 'Balanced', detailed: 'Higher' }[detail];
  return `Black and white monochrome line art of ${subject.trim()}. ${level} level of detail, suitable for carving. White background, no shading or text.`;
}

export function nativeImageUrl(config: NativeImageConfig): string {
  if (!config.model.trim() || !config.key.trim() || !['low', 'medium', 'high'].includes(config.quality))
    throw new Error('Choose a native image model, key and image quality.');
  const chatUrl = providerUrl({
    kind: 'compatible',
    protocol: 'chat',
    endpoint: config.endpoint,
    model: config.model,
    tools: true,
    images: false,
  });
  return `${chatUrl.slice(0, -'chat/completions'.length)}images/generations`;
}

function isGeminiEndpoint(endpoint: string): boolean {
  try {
    return new URL(endpoint).hostname === 'generativelanguage.googleapis.com';
  } catch {
    return false;
  }
}

/** One bounded image request, shared by native SVG and monochrome PNG routes. Never returns provider error bodies. */
export async function requestNativeImage(
  request: ProviderRequest,
  config: NativeImageConfig,
  format: 'svg' | 'png',
  fetcher: typeof fetch
): Promise<string> {
  const url = nativeImageUrl(config);
  if (format === 'svg' && isGeminiEndpoint(config.endpoint))
    throw new Error('Gemini image models make PNG images only. Set Image output to "Monochrome image (PNG), traced locally".');
  if (request.signal.aborted) throw new DOMException('Stopped', 'AbortError');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: () => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => {
      controller.abort();
      reject(new DOMException('Stopped', 'AbortError'));
    };
    request.signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Native image generation took too long. Try again or choose lower image quality.'));
    }, request.timeoutMs ?? 90_000);
  });
  const operation = async () => {
    let prompt: string;
    if (format === 'png') {
      const data = JSON.parse(request.messages[0].text) as { brief: string; constraints: { detail: 'simple' | 'balanced' | 'detailed' } };
      prompt = buildRasterArtPrompt(data.brief, data.constraints.detail);
    } else
      prompt = `${request.system.replace('Return exactly one submit_carving_svg tool call; do not ask questions or return prose instead.', 'Return the illustration itself as a static SVG.')}\nBrief (data):\n${request.messages[0].text}`;
    let response: Response;
    try {
      response = await fetcher(url, {
        method: 'POST',
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.key}` },
        body: JSON.stringify(
          isGeminiEndpoint(config.endpoint)
            ? // Gemini's compatible image API returns PNG as base64 and takes no OpenAI quality, format or size options.
              { model: config.model, prompt, n: 1, response_format: 'b64_json' }
            : {
                model: config.model,
                prompt,
                output_format: format,
                n: 1,
                quality: config.quality,
                // Standard square output; local tracing downsamples within its one-million-working-pixel bound.
                size: format === 'png' ? '1024x1024' : 'auto',
              }
        ),
      });
    } catch {
      throw new Error('Could not reach the native image provider. Check browser access and the endpoint.');
    }
    if (!response.ok)
      throw new Error(`Native image request failed (HTTP ${response.status}). Check model/project format and size support, and quota.`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('The native image provider returned no artwork.');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    const limit = format === 'png' ? 2_800_000 : 100_000;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.length;
      if (bytes > limit) {
        await reader.cancel();
        throw new Error('The native artwork exceeds the response limit.');
      }
      chunks.push(next.value);
    }
    const data = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    try {
      const payload = JSON.parse(new TextDecoder().decode(data)) as { data?: { b64_json?: string }[] };
      if (payload.data?.length !== 1 || typeof payload.data[0].b64_json !== 'string') throw new Error();
      return payload.data[0].b64_json;
    } catch {
      throw new Error('The native image provider returned an unsupported artwork response.');
    }
  };
  try {
    return await Promise.race([operation(), interrupted]);
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', abort);
  }
}

/** Image/SVG authoring charges cannot be inferred from text token prices. */
export function nativeBudgetRefusal(maxCostUsd: number | undefined): void {
  if (maxCostUsd !== undefined)
    throw new Error('Native generation has unknown combined image and SVG cost. A dollar-capped run requires the text SVG route.');
}
