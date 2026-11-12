import { generateCarvingAsset, type CarvingGenerationOptions } from './generation';
import { nativeBudgetRefusal, nativeImageUrl, requestNativeImage, type NativeImageConfig } from './nativeImage';

export type NativeSvgConfig = NativeImageConfig;

/**
 * Optional capability, explicitly selected for a model/project that supports SVG generation.
 * https://developers.openai.com/api/docs/guides/image-generation#generate-svg-output
 * Native SVG charges include a reference image and SVG authoring. Text-model prices cannot price this request.
 */
export async function generateNativeSvgAsset(options: CarvingGenerationOptions, native: NativeSvgConfig, fetcher: typeof fetch = fetch) {
  nativeBudgetRefusal(options.limits?.maxCostUsd);
  if (options.previous) throw new Error('Native SVG generation creates new artwork. Use the text SVG route to revise an existing source.');
  nativeImageUrl(native);
  return generateCarvingAsset({
    ...options,
    credentials: {
      config: { ...options.credentials.config, kind: 'compatible', endpoint: native.endpoint, model: native.model },
      key: native.key,
    },
    pricing: undefined,
    request: async request => {
      const base64 = await requestNativeImage(request, native, 'svg', fetcher);
      let svg: string;
      try {
        svg = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(base64), char => char.charCodeAt(0)));
      } catch {
        throw new Error('The native SVG provider returned an unsupported artwork response.');
      }
      return {
        role: 'assistant',
        text: '',
        completion: 'complete',
        calls: [
          {
            id: crypto.randomUUID(),
            name: 'submit_carving_svg',
            arguments: {
              svg,
              title: 'Generated carving',
              summary: 'Native SVG illustration; review subject fidelity and local carving diagnostics.',
            },
          },
        ],
      };
    },
  });
}
