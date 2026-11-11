import { expect, it } from 'vitest';
import imagegenOwlUrl from './fixtures/owl-imagegen-line-art.png?url';
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
