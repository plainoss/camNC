import { describe, expect, it } from 'vitest';
import detailedOwlUrl from './fixtures/owl-imagegen-detailed.png?url';
import readingMouseUrl from './fixtures/mouse-imagegen-reading.png?url';
import { carvingBoard, kDefaultVBit } from '../carving';
import { prepareCarvingArt } from './prepare';
import { traceCarvingPngFile } from './rasterSource';
import { sanitizeCarvingSvg } from './sanitize';

// Two generated 1024 px line drawings (converted to grayscale) that failed to trace: a detailed owl reading a book, at
// about 150 contours, and a simple mouse with thin strokes. The owl took about 6600 curve segments and the mouse lost
// overlap at Simple although its edges were within half a pixel.
const fixtures = [
  ['detailed owl', detailedOwlUrl],
  ['simple mouse', readingMouseUrl],
] as const;
const settings = [
  [60, 'simple', 1],
  [100, 'simple', 1],
  [100, 'balanced', 0.6],
  [150, 'detailed', 0.3],
] as const;

const file = async (url: string) => new File([await (await fetch(url)).blob()], 'art.png', { type: 'image/png' });
const prepare = (
  size: number,
  detail: 'simple' | 'balanced' | 'detailed',
  traced: { svg: string; sourceOutline?: { x: number; y: number }[][] }
) =>
  prepareCarvingArt({
    width: size,
    height: size,
    detail,
    carving: { items: [], region: [], vBit: kDefaultVBit, maxDepth: 3, clearWithFlat: false },
    board: carvingBoard({ w: size + 50, h: size + 50, thickness: 18 }),
    sourceOutline: traced.sourceOutline,
    art: { kind: 'svg', svg: traced.svg, fileName: 'art.svg' },
  });

describe('generated line art', () => {
  it.each(fixtures)(
    'traces the %s at every detail level and common sizes',
    async (_, url) => {
      const art = await file(url);
      for (const [size, detail, minFeatureMm] of settings) {
        const traced = await traceCarvingPngFile(art, { widthMm: size, heightMm: size, detail, minFeatureMm });
        expect(sanitizeCarvingSvg(traced.svg)).toContain('<path');
        expect(traced.traceReport!.components).toBeGreaterThanOrEqual(8);
        expect(traced.traceReport!.holes).toBeGreaterThanOrEqual(15);
        expect(traced.traceReport!.boundaryErrorMm).toBeLessThan(0.5);
        expect(traced.traceReport!.intersectionOverUnion).toBeGreaterThan(0.9);
      }
    },
    60_000
  );

  it('prepares the detailed owl for carving at 100 mm and Balanced detail', async () => {
    const traced = await traceCarvingPngFile(await file(detailedOwlUrl), {
      widthMm: 100,
      heightMm: 100,
      detail: 'balanced',
      minFeatureMm: 0.6,
    });
    const result = await prepare(100, 'balanced', traced);
    expect(result.report.errors).toEqual([]);
    expect(result.report.camPasses).toBeGreaterThan(0);
  }, 120_000);

  it('prepares the simple mouse for carving at 60 mm and Simple detail', async () => {
    const traced = await traceCarvingPngFile(await file(readingMouseUrl), { widthMm: 60, heightMm: 60, detail: 'simple', minFeatureMm: 1 });
    const result = await prepare(60, 'simple', traced);
    expect(result.report.errors).toEqual([]);
    expect(result.report.camPasses).toBeGreaterThan(0);
  }, 60_000);
});
