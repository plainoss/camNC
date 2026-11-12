import { generateCarvingAsset, type CarvingGenerationOptions } from './generation';
import { nativeBudgetRefusal, nativeImageUrl, requestNativeImage, type NativeImageConfig } from './nativeImage';
import { traceCarvingPng, type TracedCarvingRaster } from './rasterSource';

/** Generate one PNG, trace it locally, and keep the original image separate from inert vector source. */
export async function generateNativeRasterAsset(
  options: CarvingGenerationOptions,
  native: NativeImageConfig,
  fetcher: typeof fetch = fetch
): Promise<Awaited<ReturnType<typeof generateCarvingAsset>>> {
  nativeBudgetRefusal(options.limits?.maxCostUsd);
  if (options.previous) throw new Error('Native raster generation creates new artwork. Use text SVG to revise a saved composition.');
  nativeImageUrl(native);
  let traced: TracedCarvingRaster | undefined;
  const result = await generateCarvingAsset({
    ...options,
    credentials: {
      config: { ...options.credentials.config, kind: 'compatible', endpoint: native.endpoint, model: native.model },
      key: native.key,
    },
    pricing: undefined,
    locallyTraced: true,
    request: async request => {
      const base64 = await requestNativeImage(request, native, 'png', fetcher);
      traced = await traceCarvingPng(base64, options.constraints, request.signal);
      return {
        role: 'assistant',
        text: '',
        completion: 'complete',
        calls: [
          {
            id: crypto.randomUUID(),
            name: 'submit_carving_svg',
            arguments: {
              svg: traced.svg,
              title: 'Traced carving illustration',
              summary: 'Monochrome image traced into filled cut regions. Review image-to-contour losses before applying.',
            },
          },
        ],
      };
    },
  });
  return {
    ...result,
    asset: { ...result.asset, rasterPreview: traced!.rasterPreview, warnings: traced!.warnings, sourceOutline: traced!.sourceOutline },
  };
}
