import { expect, it } from 'vitest';
import imagegenOwlUrl from './fixtures/owl-imagegen-line-art.png?url';
import imagegenReadingOwlUrl from './fixtures/owl-imagegen-reading.png?url';
import directOwl from './fixtures/owl-reading.svg?raw';
import { traceCarvingPngFile } from './rasterSource';
import { prepareCarvingArt } from './prepare';
import { carvingBoard, kDefaultVBit } from '../carving';

// Actual built-in imagegen output from the short art prompt, not synthetic rectangles or a provider stub.
it('traces simple imagegen line art and checks it through the same physical carving pipeline as direct SVG', async () => {
  const blob = await (await fetch(imagegenOwlUrl)).blob();
  const traced = await traceCarvingPngFile(new File([blob], 'owl-imagegen.png', { type: 'image/png' }), {
    widthMm: 150,
    heightMm: 150,
    detail: 'simple',
    minFeatureMm: 1,
  });
  expect(traced.rasterPreview.width).toBe(1312);
  expect(traced.rasterPreview.height).toBe(1199);
  expect(traced.svg).not.toContain('<image');
  expect(traced.svg).toMatch(/[CQ]/);
  expect(traced.sourceOutline?.length).toBeGreaterThan(0);
  expect(traced.warnings.join(' ')).toMatch(/tracing|Tracing/);
  const options = {
    width: 150,
    height: 150,
    detail: 'simple' as const,
    carving: { items: [], region: [], vBit: kDefaultVBit, maxDepth: 2, clearWithFlat: false },
    board: carvingBoard({ w: 200, h: 200, thickness: 18 }),
  };
  for (const source of [
    { svg: traced.svg, sourceOutline: traced.sourceOutline },
    { svg: directOwl, sourceOutline: undefined },
  ]) {
    const result = await prepareCarvingArt({
      ...options,
      sourceOutline: source.sourceOutline,
      art: { kind: 'svg', svg: source.svg, fileName: 'owl.svg' },
    });
    expect(result.report.errors).toEqual([]);
    expect(result.report.camPasses).toBeGreaterThan(0);
    expect(result.width).toBeLessThanOrEqual(150.001);
    expect(result.height).toBeLessThanOrEqual(150.001);
    expect(Math.max(result.width, result.height)).toBeGreaterThan(140);
  }
}, 30_000);

// Low-quality 1024 px generated owl (converted to grayscale). It has anti-aliased pinholes where shapes nearly touch,
// gap tips narrower than a pixel and enough outline to have exceeded the curve budgets at a sub-pixel tolerance.
it('traces generated line art with pixel-sized pinholes at every detail level and common sizes', async () => {
  const blob = await (await fetch(imagegenReadingOwlUrl)).blob();
  for (const [size, detail, minFeatureMm] of [
    [60, 'simple', 1],
    [100, 'simple', 1],
    [100, 'balanced', 0.6],
    [150, 'detailed', 0.3],
    [300, 'balanced', 0.6],
  ] as const) {
    const traced = await traceCarvingPngFile(new File([blob], 'owl.png', { type: 'image/png' }), {
      widthMm: size,
      heightMm: size,
      detail,
      minFeatureMm,
    });
    expect(traced.traceReport!.components).toBeGreaterThanOrEqual(8);
    expect(traced.traceReport!.intersectionOverUnion).toBeGreaterThan(0.97);
  }
  const traced = await traceCarvingPngFile(new File([blob], 'owl.png', { type: 'image/png' }), {
    widthMm: 60,
    heightMm: 60,
    detail: 'simple',
    minFeatureMm: 1,
  });
  expect(traced.traceReport!.filledPinholes).toBeGreaterThan(0);
  const result = await prepareCarvingArt({
    width: 60,
    height: 60,
    detail: 'simple',
    carving: { items: [], region: [], vBit: kDefaultVBit, maxDepth: 2, clearWithFlat: false },
    board: carvingBoard({ w: 100, h: 100, thickness: 18 }),
    sourceOutline: traced.sourceOutline,
    art: { kind: 'svg', svg: traced.svg, fileName: 'owl.svg' },
  });
  expect(result.report.errors).toEqual([]);
  expect(result.report.camPasses).toBeGreaterThan(0);
}, 60_000);
