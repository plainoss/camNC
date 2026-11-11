import type { CarvingGenerationConstraints, GeneratedCarvingAsset } from './generation';
import { traceCarvingPngFile } from './rasterSource';

/** Keep original local artwork as an asset; the shared file tracer owns decoding, bounds and cancellation. */
export async function readCarvingPngAsset(
  file: File,
  constraints: CarvingGenerationConstraints,
  signal: AbortSignal
): Promise<GeneratedCarvingAsset> {
  const traced = await traceCarvingPngFile(file, constraints, signal);
  if (signal.aborted) throw new DOMException('PNG import stopped.', 'AbortError');
  const title = file.name.replace(/\.png$/i, '').slice(0, 100) || 'Imported line art';
  return {
    id: crypto.randomUUID(),
    title,
    prompt: `Line art from ${title}`,
    summary: 'Locally imported PNG traced into filled carving regions. Review the original and prepared artwork.',
    ...traced,
  };
}
