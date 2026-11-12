import { describe, expect, it, vi } from 'vitest';
import { generateNativeRasterAsset } from './nativeRaster';
import { boundedCarvingRasterPreview, traceCarvingPng, traceCarvingPngFile } from './rasterSource';
import { sanitizeCarvingSvg } from './sanitize';
import { outlineArt } from '../carvingOutline';
import type { CarvingGenerationOptions } from './generation';
import { buildRasterArtPrompt } from './nativeImage';
import actualOwlUrl from './fixtures/owl-imagegen-line-art.png?url';

const constraints = { widthMm: 80, heightMm: 80, detail: 'balanced' as const, minFeatureMm: 0.6 };
const native = { endpoint: 'https://native.example/v1', model: 'image-model', key: 'native-secret', quality: 'low' as const };
function png(paint?: (context: CanvasRenderingContext2D) => void): string {
  const canvas = document.createElement('canvas');
  canvas.width = 100;
  canvas.height = 100;
  const context = canvas.getContext('2d')!;
  context.fillStyle = 'white';
  context.fillRect(0, 0, 100, 100);
  if (paint) paint(context);
  else {
    context.fillStyle = 'black';
    context.fillRect(10, 10, 60, 70);
    context.fillStyle = 'white';
    context.fillRect(25, 25, 20, 20);
    context.fillStyle = 'black';
    context.beginPath();
    context.arc(85, 80, 8, 0, Math.PI * 2);
    context.fill();
  }
  return canvas.toDataURL('image/png').split(',')[1];
}
const options = (): CarvingGenerationOptions => ({
  prompt: 'A mouse with a ball',
  constraints,
  signal: new AbortController().signal,
  credentials: {
    key: 'text-secret',
    config: { kind: 'compatible', endpoint: 'https://text.example', model: 'text-model', protocol: 'chat', tools: true, images: false },
  },
});

describe('native monochrome generation and tracing', () => {
  it('uses one separately authenticated PNG generation and keeps its source image outside SVG', async () => {
    const original = png();
    const fetcher = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ data: [{ b64_json: original }] }))
    );
    const result = await generateNativeRasterAsset(options(), native, fetcher);
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe('https://native.example/v1/images/generations');
    expect(JSON.parse(request!.body as string)).toMatchObject({ output_format: 'png', size: '1024x1024', n: 1 });
    expect(JSON.parse(request!.body as string).prompt).not.toContain('inside an SVG');
    expect(JSON.parse(request!.body as string).prompt).not.toContain('submit_carving_svg');
    expect(JSON.parse(request!.body as string).prompt).toBe(
      'Black and white monochrome line art of A mouse with a ball. Balanced level of detail, suitable for carving. White background, no shading or text.'
    );
    expect(JSON.parse(request!.body as string).prompt).not.toMatch(/viewBox|path|tool|CAD|minFeatureMm|widthMm|heightMm|80|0\.6/i);
    expect(request!.headers).toMatchObject({ authorization: 'Bearer native-secret' });
    expect(result.asset.rasterPreview).toEqual({ dataUri: `data:image/png;base64,${original}`, width: 100, height: 100 });
    expect(boundedCarvingRasterPreview(result.asset.rasterPreview)).toBe(`data:image/png;base64,${original}`);
    expect(result.asset.svg).not.toContain('<image');
    expect(result.asset.svg).not.toContain(original);
    expect(sanitizeCarvingSvg(result.asset.svg)).toContain('<path');
    expect(result.asset.warnings?.join(' ')).toContain('Shading, color and anti-aliasing are discarded');
    expect(result.usage).toMatchObject({ calls: 1, costUsd: null });
  });

  it("asks Gemini's compatible image API for base64 PNG without OpenAI-only options", async () => {
    const fetcher = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ data: [{ b64_json: png() }] }))
    );
    const gemini = { ...native, endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'imagen-4.0-generate-001' };
    await generateNativeRasterAsset(options(), gemini, fetcher);
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/images/generations');
    const body = JSON.parse(request!.body as string);
    expect(body).toMatchObject({ model: 'imagen-4.0-generate-001', n: 1, response_format: 'b64_json' });
    expect(body).not.toHaveProperty('quality');
    expect(body).not.toHaveProperty('output_format');
    expect(body).not.toHaveProperty('size');
  });

  it.each([
    ['simple', 'Low'],
    ['balanced', 'Balanced'],
    ['detailed', 'Higher'],
  ] as const)('uses standalone art direction for %s detail', (detail, descriptor) => {
    expect(buildRasterArtPrompt('an owl reading a book', detail)).toBe(
      `Black and white monochrome line art of an owl reading a book. ${descriptor} level of detail, suitable for carving. White background, no shading or text.`
    );
  });

  it('retains holes and disconnected artwork in the binary contour source', async () => {
    const result = await traceCarvingPng(png(), constraints);
    const drawn = await outlineArt({ kind: 'svg', svg: result.svg, fileName: 'trace.svg' }, 40);
    expect(drawn.region.length).toBeGreaterThanOrEqual(3);
    expect(result.warnings.join(' ')).toContain('enlargement cannot recover image detail');
  });

  it('simplifies actual imagegen curve staircases within physical detail limits while retaining its components and holes', async () => {
    const blob = await (await fetch(actualOwlUrl)).blob();
    const result = await traceCarvingPngFile(new File([blob], 'owl.png', { type: 'image/png' }), {
      widthMm: 150,
      heightMm: 150,
      detail: 'simple',
      minFeatureMm: 1,
    });
    expect(result.warnings.join(' ')).toContain('4 filled components and 12 holes remain');
    expect((result.svg.match(/[MLZ]/g) ?? []).length).toBeLessThan(2500);
    expect(sanitizeCarvingSvg(result.svg)).toContain('<path');
    expect(result.svg).toContain('C');
    expect(result.traceReport?.intersectionOverUnion).toBeGreaterThan(0.97);
    expect(result.traceReport?.boundaryErrorMm).toBeLessThan(0.5);
    expect(result.sourceOutline?.length).toBe(16);
  });

  it('smooths a circle into genuine cubic curves while removing only tiny dark specks and retaining its hole', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 400;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'white';
    context.fillRect(0, 0, 400, 400);
    context.fillStyle = 'black';
    context.beginPath();
    context.arc(200, 200, 150, 0, Math.PI * 2);
    context.fill();
    for (const [x, y] of [
      [2, 2],
      [395, 2],
      [2, 395],
      [395, 395],
    ])
      context.fillRect(x, y, 1, 1);
    context.fillStyle = 'white';
    context.beginPath();
    context.arc(200, 200, 80, 0, Math.PI * 2);
    context.fill();
    const result = await traceCarvingPng(canvas.toDataURL('image/png').split(',')[1], { ...constraints, minFeatureMm: 1 });
    expect(result.traceReport).toMatchObject({ components: 1, holes: 1, removedSpecks: 4, removedSpeckPixels: 4 });
    expect(result.traceReport).toMatchObject({ curves: 8, roundRegularized: true });
    expect(result.traceReport!.intersectionOverUnion).toBeGreaterThan(0.98);
    expect(result.traceReport!.boundaryErrorMm).toBeLessThan(0.4);
    expect(result.sourceOutline).toHaveLength(2);
    expect(result.warnings.join(' ')).toContain('Removed 4 isolated dark specks');
  });

  it('retains a one-pixel light counter and intentional square corners instead of silently filling or rounding them', async () => {
    const result = await traceCarvingPng(
      png(context => {
        context.fillStyle = 'black';
        context.fillRect(20, 20, 60, 60);
        context.fillStyle = 'white';
        context.fillRect(40, 40, 1, 1);
      }),
      constraints
    );
    expect(result.traceReport).toMatchObject({ components: 1, holes: 1 });
    expect(result.traceReport!.intersectionOverUnion).toBeGreaterThan(0.999);
    const root = new DOMParser().parseFromString(result.svg, 'image/svg+xml');
    const path = new Path2D(root.querySelector('path')!.getAttribute('d')!);
    const context = document.createElement('canvas').getContext('2d')!;
    expect(context.isPointInPath(path, 20.1, 20.1, 'evenodd')).toBe(true);
    expect(context.isPointInPath(path, 19.9, 20.1, 'evenodd')).toBe(false);
    expect(context.isPointInPath(path, 40.5, 40.5, 'evenodd')).toBe(false);
  });

  it('keeps a two-pixel wall of at least half the minimum feature, and closes it only when narrower', async () => {
    const letters = png(context => {
      context.fillStyle = 'black';
      context.fillRect(10, 30, 38, 40);
      context.fillRect(50, 30, 40, 40);
    });
    // 80 px across 32 mm is 2.5 px/mm: the 2 px wall is 0.8 mm, most of a 1 mm feature.
    const kept = await traceCarvingPng(letters, { widthMm: 32, heightMm: 32, detail: 'simple', minFeatureMm: 1 });
    expect(kept.traceReport).toMatchObject({ components: 2, holes: 0 });
    expect(kept.warnings.join(' ')).not.toContain('Closed light gaps');
    // With a 2 mm feature the same wall is 0.4 mm, below half a feature, so the letters merge and that is reported.
    const merged = await traceCarvingPng(letters, { widthMm: 32, heightMm: 32, detail: 'simple', minFeatureMm: 2 });
    expect(merged.traceReport).toMatchObject({ components: 1, holes: 0 });
    expect(merged.warnings.join(' ')).toContain('Closed light gaps');
  });

  it('rejects blank or inverted backgrounds instead of carving a background panel', async () => {
    await expect(
      traceCarvingPng(
        png(() => {}),
        constraints
      )
    ).rejects.toThrow('no dark filled');
    await expect(
      traceCarvingPng(
        png(context => {
          context.fillStyle = 'black';
          context.fillRect(0, 0, 100, 100);
        }),
        constraints
      )
    ).rejects.toThrow('mostly dark background');
  });

  it('checks byte and pixel bounds before decoding and stops already-cancelled tracing', async () => {
    await expect(traceCarvingPng('A'.repeat(2_800_001), constraints)).rejects.toThrow('2 MB');
    const bytes = Uint8Array.from(atob(png()), char => char.charCodeAt(0));
    new DataView(bytes.buffer).setUint32(16, 100_000);
    const large = btoa(String.fromCharCode(...bytes));
    await expect(traceCarvingPng(large, constraints)).rejects.toThrow('four million pixels');
    expect(boundedCarvingRasterPreview({ dataUri: `data:image/png;base64,${large}`, width: 100_000, height: 100 })).toBeNull();
    expect(boundedCarvingRasterPreview({ dataUri: `data:image/png;base64,${png()}`, width: 999, height: 100 })).toBeNull();
    const abort = new AbortController();
    abort.abort();
    await expect(traceCarvingPng(png(), constraints, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it.each([
    [1024, 1024],
    [1536, 1024],
    [2000, 2000],
  ])('decodes a normal %s × %s source and traces at most one million pixels', async (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'white';
    context.fillRect(0, 0, width, height);
    context.fillStyle = 'black';
    context.fillRect(width / 4, height / 4, width / 2, height / 2);
    context.fillStyle = 'white';
    context.fillRect(width * 0.4, height * 0.4, width * 0.2, height * 0.2);
    const original = canvas.toDataURL('image/png').split(',')[1];
    const readPixels = vi.spyOn(CanvasRenderingContext2D.prototype, 'getImageData');
    try {
      const result = await traceCarvingPng(original, constraints);
      const [, , traceWidth, traceHeight] = readPixels.mock.calls.at(-1)!;
      expect(traceWidth * traceHeight).toBeLessThanOrEqual(1_000_000);
      expect(traceWidth).toBeLessThan(width);
      expect(traceHeight).toBeLessThan(height);
      expect(result.rasterPreview).toEqual({ dataUri: `data:image/png;base64,${original}`, width, height });
      expect(boundedCarvingRasterPreview(result.rasterPreview)).toBe(result.rasterPreview.dataUri);
      const root = new DOMParser().parseFromString(result.svg, 'image/svg+xml').documentElement;
      expect(root.getAttribute('viewBox')).toBe(`0 0 ${traceWidth} ${traceHeight}`);
      expect(result.warnings.join(' ')).toContain('downsampled');
      const outlined = await outlineArt({ kind: 'svg', svg: result.svg, fileName: 'trace.svg' }, 40);
      expect(outlined.region).toHaveLength(2);
    } finally {
      readPixels.mockRestore();
    }
  });

  it('traces a local PNG upload through the same bounded path without provider access', async () => {
    const bytes = Uint8Array.from(atob(png()), char => char.charCodeAt(0));
    const result = await traceCarvingPngFile(new File([bytes], 'artwork.png', { type: 'image/png' }), constraints);
    expect(result.rasterPreview.width).toBe(100);
    expect(result.svg).toContain('<path');
    await expect(traceCarvingPngFile(new File(['not png'], 'artwork.jpg', { type: 'image/jpeg' }), constraints)).rejects.toThrow(
      'static PNG'
    );
    await expect(
      traceCarvingPngFile(new File([new Uint8Array(2_000_001)], 'large.png', { type: 'image/png' }), constraints)
    ).rejects.toThrow('2 MB');
  });

  it('stops a pending decode and revokes its temporary image URL', async () => {
    const source = png();
    const decode = vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(() => new Promise(() => {}));
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const controller = new AbortController();
    try {
      const pending = traceCarvingPng(source, constraints, controller.signal);
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(revoke).toHaveBeenCalledTimes(1);
    } finally {
      decode.mockRestore();
      revoke.mockRestore();
    }
  });

  it('bounds decode time and revokes its temporary image URL after timeout', async () => {
    const source = png();
    const decode = vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(() => new Promise(() => {}));
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    vi.useFakeTimers();
    try {
      const pending = expect(traceCarvingPng(source, constraints)).rejects.toThrow('too long to decode');
      await vi.advanceTimersByTimeAsync(10_000);
      await pending;
      expect(revoke).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      decode.mockRestore();
      revoke.mockRestore();
    }
  });

  it('rejects a source just over four million pixels before invoking the browser decoder', async () => {
    const bytes = Uint8Array.from(atob(png()), char => char.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    view.setUint32(16, 2001);
    view.setUint32(20, 2000);
    const decoder = vi.spyOn(HTMLImageElement.prototype, 'decode');
    try {
      await expect(traceCarvingPng(btoa(String.fromCharCode(...bytes)), constraints)).rejects.toThrow('four million pixels');
      expect(decoder).not.toHaveBeenCalled();
    } finally {
      decoder.mockRestore();
    }
  });

  it('rejects noisy masks before allocating an unbounded polygon union', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 400;
    const context = canvas.getContext('2d')!;
    const pixels = context.createImageData(400, 400);
    for (let y = 0; y < 400; y++)
      for (let x = 0; x < 400; x++) {
        const i = (y * 400 + x) * 4,
          value = (x + y) % 2 ? 255 : 0;
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
        pixels.data[i + 3] = 255;
      }
    context.putImageData(pixels, 0, 0);
    await expect(traceCarvingPng(canvas.toDataURL('image/png').split(',')[1], constraints)).rejects.toThrow('too many pixel runs');
  });

  it('rejects animated PNG provenance before browser decoding', async () => {
    const bytes = Uint8Array.from(atob(png()), char => char.charCodeAt(0));
    const animated = new Uint8Array(bytes.length + 20);
    animated.set(bytes.slice(0, 33));
    new DataView(animated.buffer).setUint32(33, 8);
    animated.set([97, 99, 84, 76], 37);
    animated.set(bytes.slice(33), 53);
    const source = btoa(String.fromCharCode(...animated));
    await expect(traceCarvingPng(source, constraints)).rejects.toThrow('static PNG');
    expect(boundedCarvingRasterPreview({ dataUri: `data:image/png;base64,${source}`, width: 100, height: 100 })).toBeNull();
  });

  it('refuses dollar caps before a native PNG request', async () => {
    const fetcher = vi.fn();
    await expect(generateNativeRasterAsset({ ...options(), limits: { maxCostUsd: 1 } }, native, fetcher)).rejects.toThrow(
      'unknown combined'
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
