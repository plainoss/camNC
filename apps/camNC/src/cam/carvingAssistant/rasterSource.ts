import type { CarvingGenerationConstraints } from './generation';
import { smoothTrace } from './smoothTrace';
import { compareTraceMasks, fillTracePinholes, removeTraceSpecks, traceMaskTopology, type TraceCoverage } from './traceMetrics';

export interface TracedCarvingRaster {
  svg: string;
  rasterPreview: { dataUri: string; width: number; height: number };
  warnings: string[];
  sourceOutline?: { x: number; y: number }[][];
  traceReport?: TraceCoverage & {
    boundaryErrorMm: number;
    curves: number;
    lines: number;
    components: number;
    holes: number;
    removedSpecks: number;
    removedSpeckPixels: number;
    filledPinholes?: number;
    roundRegularized?: boolean;
  };
}

const abort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Raster tracing stopped.', 'AbortError');
};
const maxSourcePixels = 4_000_000;
const maxTracePixels = 1_000_000;

/** Validate the PNG dimensions before invoking a decoder: compressed images must not allocate an unbounded canvas. */
function pngBytes(base64: string): { bytes: Uint8Array<ArrayBuffer>; width: number; height: number } {
  if (!base64 || base64.length > 2_800_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64))
    throw new Error('Use a PNG source no larger than 2 MB.');
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = Uint8Array.from(atob(base64), value => value.charCodeAt(0));
  } catch {
    throw new Error('The raster provider returned invalid PNG data.');
  }
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length > 2_000_000 || bytes.length < 33 || !signature.every((value, i) => bytes[i] === value))
    throw new Error('Use a PNG source no larger than 2 MB.');
  const data = new DataView(bytes.buffer);
  if (data.getUint32(8) !== 13 || String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') throw new Error('The PNG header is invalid.');
  const width = data.getUint32(16),
    height = data.getUint32(20);
  if (!width || !height || width * height > maxSourcePixels)
    throw new Error('Raster sources must contain at most four million pixels before decoding.');
  let cursor = 8,
    chunks = 0;
  while (cursor + 12 <= bytes.length) {
    const length = data.getUint32(cursor);
    const kind = String.fromCharCode(...bytes.slice(cursor + 4, cursor + 8));
    if (cursor + length + 12 > bytes.length || ++chunks > 4096) throw new Error('The PNG chunks are invalid or too complex.');
    // A small APNG can contain many full-sized frames. Only static artwork is permitted by the decode bound.
    if (kind === 'acTL' || kind === 'fcTL' || kind === 'fdAT') throw new Error('Use a static PNG, without animated frames.');
    cursor += length + 12;
    if (kind === 'IEND') break;
  }
  return { bytes, width, height };
}

/** Imported job provenance is untrusted too: check encoded size and PNG header before presenting its preview. */
export function boundedCarvingRasterPreview(source: { dataUri: string; width: number; height: number } | undefined): string | null {
  if (typeof source?.dataUri !== 'string' || !source.dataUri.startsWith('data:image/png;base64,')) return null;
  try {
    const decoded = pngBytes(source.dataUri.slice('data:image/png;base64,'.length));
    return decoded.width === source.width && decoded.height === source.height ? source.dataUri : null;
  } catch {
    return null;
  }
}

/** Local upload follows exactly the provider-output trace path and never makes an external request. */
export async function traceCarvingPngFile(
  file: File,
  constraints: CarvingGenerationConstraints,
  signal?: AbortSignal
): Promise<TracedCarvingRaster> {
  abort(signal);
  if (file.size > 2_000_000 || (file.type && file.type !== 'image/png')) throw new Error('Choose a static PNG file no larger than 2 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  abort(signal);
  let binary = '';
  // Avoid spreading a whole multi-megabyte image onto the JavaScript argument stack.
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return traceCarvingPng(btoa(binary), constraints, signal);
}

/** Convert a bounded monochrome PNG into inert filled vector regions. Original PNG is kept separately from SVG markup. */
export async function traceCarvingPng(
  base64: string,
  constraints: CarvingGenerationConstraints,
  signal?: AbortSignal
): Promise<TracedCarvingRaster> {
  abort(signal);
  if ([constraints.widthMm, constraints.heightMm, constraints.minFeatureMm].some(value => !Number.isFinite(value) || value <= 0))
    throw new Error('Raster tracing requires a positive physical size and detail threshold.');
  const { bytes, width, height } = pngBytes(base64);
  const image = new Image();
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: () => void = () => {};
  try {
    image.src = url;
    const interrupted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new DOMException('Raster tracing stopped.', 'AbortError'));
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => reject(new Error('The PNG source took too long to decode.')), 10_000);
    });
    await Promise.race([image.decode(), interrupted]);
    abort(signal);
    if (image.naturalWidth !== width || image.naturalHeight !== height) throw new Error('PNG decoded dimensions do not match its header.');
    // Decode at most 4m source pixels, then trace at most 1m. Standard image output can exceed the working grid
    // without allocating a second full-source canvas or silently changing the original saved preview dimensions.
    const scale = Math.min(1, Math.sqrt(maxTracePixels / (width * height)));
    let traceWidth = Math.max(1, Math.floor(width * scale));
    let traceHeight = Math.max(1, Math.floor(height * scale));
    if (traceWidth * traceHeight > maxTracePixels) {
      if (traceWidth >= traceHeight) traceWidth = Math.floor(maxTracePixels / traceHeight);
      else traceHeight = Math.floor(maxTracePixels / traceWidth);
    }
    const canvas = document.createElement('canvas');
    canvas.width = traceWidth;
    canvas.height = traceHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('This browser cannot trace raster artwork.');
    context.fillStyle = 'white';
    context.fillRect(0, 0, traceWidth, traceHeight);
    context.drawImage(image, 0, 0, traceWidth, traceHeight);
    const pixels = context.getImageData(0, 0, traceWidth, traceHeight).data;
    const ink = new Uint8Array(traceWidth * traceHeight);
    let x0 = traceWidth,
      x1 = 0,
      y0 = traceHeight,
      y1 = 0,
      count = 0,
      runs = 0;
    for (let i = 0; i < ink.length; i++) {
      if ((pixels[i * 4] + pixels[i * 4 + 1] + pixels[i * 4 + 2]) / 3 >= 127.5) continue;
      ink[i] = 1;
      count++;
      if ((i % traceWidth === 0 || !ink[i - 1]) && ++runs > 20_000)
        throw new Error('Artwork has too many pixel runs. Use simpler filled shapes.');
      const x = i % traceWidth,
        y = Math.floor(i / traceWidth);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x + 1);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y + 1);
    }
    if (!count) throw new Error('The image has no dark filled regions to carve.');
    if (count > ink.length * 0.9) throw new Error('The image is mostly dark background. Request black artwork on a white background.');
    const pixelsPerMm = Math.max((x1 - x0) / constraints.widthMm, (y1 - y0) / constraints.heightMm);
    // Never fit below about a pixel: the source cannot resolve finer detail, and a sub-pixel tolerance follows the
    // anti-aliasing staircase, which multiplies the curve count (about four times on 1024 px generated line art).
    const tolerancePx = Math.max(1.25, Math.min(3, (constraints.minFeatureMm * pixelsPerMm) / 4));
    const physicalNoiseAreaPx = ((constraints.minFeatureMm * pixelsPerMm) / 2) ** 2;
    const noiseAreaPx = Math.max(2, physicalNoiseAreaPx);
    const specks = removeTraceSpecks(ink, traceWidth, noiseAreaPx);
    if (!ink.some(Boolean)) throw new Error('Physical noise cleanup removed all artwork. Use a finer detail level or larger artwork.');
    // Anti-aliased edges leave pixel-sized light gaps where two dark shapes nearly touch. Fill those below the physical
    // threshold; no tool leaves such an island. A pixel that is physically large, as in a small source, stays a counter.
    const pinholes = fillTracePinholes(ink, traceWidth, physicalNoiseAreaPx);
    // Give Stop a boundary before bounded polygon union. Subsequent physical preparation applies its own geometry limits.
    await new Promise(resolve => setTimeout(resolve, 0));
    abort(signal);
    const topology = traceMaskTopology(ink, traceWidth);
    if (!topology.components || topology.components + topology.holes > 300)
      throw new Error('Raster tracing is too complex. Request fewer details or simpler line art.');
    const smooth = await smoothTrace(
      ink,
      traceWidth,
      traceHeight,
      tolerancePx,
      0.015 * pixelsPerMm,
      signal,
      Math.min(1, constraints.minFeatureMm) * pixelsPerMm
    );
    abort(signal);
    context.fillStyle = 'white';
    context.fillRect(0, 0, traceWidth, traceHeight);
    context.fillStyle = 'black';
    context.fill(new Path2D(smooth.d), 'evenodd');
    const checkedPixels = context.getImageData(0, 0, traceWidth, traceHeight).data;
    const checkedMask = Uint8Array.from({ length: ink.length }, (_, i) => (checkedPixels[i * 4] < 128 ? 1 : 0));
    // Rasterizing two curves that nearly touch can leave a sliver or pinhole a few pixels across between them, and a
    // pinhole that small next to an edge cannot survive curve fitting at this tolerance. Require every feature at least
    // three tolerances across to be kept, and no such feature to appear, counting the other side down to half that area
    // so a feature that shrinks or grows slightly across the threshold is not miscounted.
    const featureAreaPx = Math.max(noiseAreaPx, (3 * tolerancePx) ** 2);
    const features = (mask: Uint8Array, area: number) => {
      const copy = mask.slice();
      removeTraceSpecks(copy, traceWidth, area);
      fillTracePinholes(copy, traceWidth, area);
      return traceMaskTopology(copy, traceWidth);
    };
    const [sourceLarge, sourceAny] = [features(ink, featureAreaPx), features(ink, featureAreaPx / 2)];
    const [tracedLarge, tracedAny] = [features(checkedMask, featureAreaPx), features(checkedMask, featureAreaPx / 2)];
    if (
      smooth.components !== topology.components ||
      smooth.holes !== topology.holes ||
      tracedAny.components < sourceLarge.components ||
      tracedAny.holes < sourceLarge.holes ||
      sourceAny.components < tracedLarge.components ||
      sourceAny.holes < tracedLarge.holes
    )
      throw new Error('Smooth tracing changed filled components or holes. Use a larger size or finer detail level.');
    const coverage = compareTraceMasks(ink, checkedMask, traceWidth, Math.ceil(tolerancePx + 2));
    if (coverage.intersectionOverUnion < 0.96 || coverage.typicalBoundaryErrorPx > tolerancePx + 1.5)
      throw new Error('Smooth tracing exceeded its measured coverage or boundary-error budget. Use a larger source or simpler artwork.');
    const warnings = [
      'Raster tracing converts dark pixels to filled cut regions. Shading, color and anti-aliasing are discarded; compare the original image and traced contours.',
      `Smooth tracing uses ${smooth.curves} cubic curves and ${smooth.lines} lines; ${topology.components} filled components and ${topology.holes} holes remain. Gentle curve joins have aligned tangents; sharp corners and straight edges are retained.`,
      `Measured raster contour boundary error is ${(coverage.typicalBoundaryErrorPx / pixelsPerMm).toFixed(3)} mm for 99.9% of the outline; coverage overlap ${(coverage.intersectionOverUnion * 100).toFixed(2)}%; enlargement cannot recover image detail. Compare the source and smooth trace.`,
      `Removed ${specks.components} isolated dark specks (${specks.pixels} tracing pixels) below the physical noise threshold. Small intended marks can also be removed.`,
      ...(pinholes.components
        ? [`Filled ${pinholes.components} enclosed light pinholes (${pinholes.pixels} tracing pixels) below the physical noise threshold.`]
        : []),
      `Curve-fitting microcorners spanning less than ${Math.min(1, constraints.minFeatureMm)} mm are smoothed; original long corners remain pinned.`,
    ];
    if (smooth.roundRegularized)
      warnings.push(
        'Near-elliptical contours were fitted as smooth ellipses, including round pupils or counters, and checked against the original pixel coverage.'
      );
    if (traceWidth !== width || traceHeight !== height)
      warnings.push(
        `The ${width} × ${height} pixel source was downsampled to a ${traceWidth} × ${traceHeight} tracing grid. The original image is retained.`
      );
    if (1 / pixelsPerMm > constraints.minFeatureMm / 2)
      warnings.push(
        'The source image has fewer than two pixels across the requested minimum feature. Enlarge details or request simpler artwork.'
      );
    return {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${traceWidth} ${traceHeight}"><path fill="black" fill-rule="evenodd" d="${smooth.d}"/></svg>`,
      rasterPreview: { dataUri: `data:image/png;base64,${base64}`, width, height },
      warnings,
      sourceOutline: smooth.outline.map(loop =>
        loop.map(p => ({ x: (p.x - traceWidth / 2) / pixelsPerMm, y: (traceHeight / 2 - p.y) / pixelsPerMm }))
      ),
      traceReport: {
        ...coverage,
        boundaryErrorMm: coverage.typicalBoundaryErrorPx / pixelsPerMm,
        curves: smooth.curves,
        lines: smooth.lines,
        components: topology.components,
        holes: topology.holes,
        removedSpecks: specks.components,
        removedSpeckPixels: specks.pixels,
        filledPinholes: pinholes.components,
        roundRegularized: smooth.roundRegularized,
      },
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    image.src = '';
    URL.revokeObjectURL(url);
  }
}
