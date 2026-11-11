import { describe, expect, it } from 'vitest';
import { carvingBoard, kDefaultVBit, type CarvingArt, type CarvingV1 } from '../carving';
import { prepareCarvingArt } from './prepare';
import { sanitizeCarvingSvg } from './sanitize';
import { maskOutline } from '../carvingOutline';
import { checkCarvingInWorker } from './camCheck';

const svg = (content: string): CarvingArt => ({
  kind: 'svg',
  svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${content}</svg>`,
  fileName: 'drawing.svg',
});
const carving: CarvingV1 = { items: [], region: [], vBit: kDefaultVBit, maxDepth: 2, clearWithFlat: false };
const board = carvingBoard({ w: 100, h: 100, thickness: 18 });
const options = { width: 30, height: 30, detail: 'balanced' as const, carving, board };

describe('generated carving preparation', () => {
  it('fits actual ink, excluding source whitespace, and produces checked centered cuts', async () => {
    const result = await prepareCarvingArt({ ...options, art: svg('<rect x="40" y="45" width="20" height="10"/>') });
    expect(result.width).toBeCloseTo(30, 1);
    expect(result.height).toBeCloseTo(15, 1);
    expect(result.report.ok).toBe(true);
    expect(result.operations.length).toBeGreaterThan(0);
    expect(result.report.camPasses).toBeGreaterThan(0);
    const points = result.outline.flat();
    expect(Math.max(...points.map(p => p.x))).toBeCloseTo(15, 1);
    expect(Math.min(...points.map(p => p.x))).toBeCloseTo(-15, 1);
    const reparsed = await prepareCarvingArt({ ...options, art: result.art });
    expect(reparsed.width).toBeCloseTo(result.width, 1);
    expect(reparsed.height).toBeCloseTo(result.height, 1);
  });

  it('removes isolated noise according to physical size, retaining source separately', async () => {
    const art = svg('<rect x="20" y="20" width="60" height="30"/><rect x="85" y="25" width="1" height="1"/>');
    const original = structuredClone(art);
    const result = await prepareCarvingArt({ ...options, art, detail: 'simple' });
    expect(result.report.removedComponents).toBe(1);
    expect(result.report.sourceComponents).toBe(2);
    expect(result.report.warnings.join(' ')).toContain('Removed 1');
    expect(art).toEqual(original);
    const detailed = await prepareCarvingArt({ ...options, art, width: 100, height: 100, detail: 'detailed' });
    expect(detailed.report.removedComponents).toBe(0);
  });

  it('preserves holes and explicitly warns about small components', async () => {
    const result = await prepareCarvingArt({
      ...options,
      art: svg('<path fill-rule="evenodd" d="M10 10H80V80H10Z M30 30H60V60H30Z"/><rect x="85" y="25" width="1" height="1"/>'),
      detail: 'simple',
    });
    expect(result.outline.length).toBeGreaterThanOrEqual(2);
    expect(result.report.removedComponents).toBe(1);
    expect(result.report.warnings.join(' ')).toContain('holes were preserved');
  });

  it('simplifies a connected thin branch at physical scale and reports changed cut area', async () => {
    const art = svg('<path d="M10 10H50V40H90V41H50V90H10Z"/>');
    const simple = await prepareCarvingArt({ ...options, art, detail: 'simple' });
    const detailed = await prepareCarvingArt({ ...options, art, detail: 'detailed' });
    expect(simple.report.removedCutAreaMm2).toBeGreaterThan(detailed.report.removedCutAreaMm2 + 1);
    expect(simple.width).toBeLessThan(detailed.width);
    expect(simple.report.warnings.join(' ')).toContain('narrow branches');
  });

  it('locates a compact lost spike for the board to circle, but not slivers along long outlines', async () => {
    const result = await prepareCarvingArt({
      ...options,
      art: svg('<path d="M10 10H90V90H10Z"/><rect x="49" y="4" width="1.5" height="7"/>'),
      detail: 'simple',
    });
    const spots = result.problemAreas ?? [];
    expect(spots.length).toBeGreaterThan(0);
    for (const spot of spots) expect(spot.r).toBeLessThan(5);
    // The spike sits at the top centre of the drawing: Y up, centred on the accepted ink.
    expect(spots.some(spot => Math.abs(spot.x) < 2 && spot.y > 10)).toBe(true);
    const branch = await prepareCarvingArt({ ...options, art: svg('<path d="M10 10H50V40H90V41H50V90H10Z"/>'), detail: 'simple' });
    expect(branch.report.removedCutAreaMm2).toBeGreaterThan(1);
    expect(branch.problemAreas?.every(spot => spot.r < 5)).toBe(true);
  });

  it('warns about narrow remaining gaps without filling them', async () => {
    const result = await prepareCarvingArt({
      ...options,
      art: svg('<rect x="10" y="10" width="30" height="80"/><rect x="41" y="10" width="30" height="80"/>'),
      detail: 'simple',
    });
    expect(result.report.narrowLandAreaMm2).toBeGreaterThan(1);
    expect(result.report.warnings.join(' ')).toContain('remaining gaps or lands');
  });

  it('refuses detail cleanup that removes most original cut area', async () => {
    const result = await prepareCarvingArt({
      ...options,
      art: svg('<path fill-rule="evenodd" d="M10 10H90V90H10Z M11 11H89V89H11Z"/><rect x="45" y="45" width="5" height="5"/>'),
      detail: 'simple',
    });
    expect(result.report.removedCutAreaFraction).toBeGreaterThan(0.5);
    expect(result.report.ok).toBe(false);
    expect(result.report.errors.join(' ')).toContain('more than half');
  });

  it('reports an isolated feature lost to a flat tip, even when other artwork cuts', async () => {
    const result = await prepareCarvingArt({
      ...options,
      art: svg('<rect x="10" y="10" width="10" height="70"/><rect x="30" y="20" width="1" height="50"/>'),
      detail: 'detailed',
      carving: { ...carving, vBit: { ...kDefaultVBit, tipDiameter: 0.8 } },
    });
    expect(result.report.ok).toBe(false);
    expect(result.report.errors.join(' ')).toContain('no wider than the V-bit tip');
  });

  it('detects local thin-branch loss for a flat tip inside a larger connected region', async () => {
    const result = await prepareCarvingArt({
      ...options,
      art: svg('<path d="M10 10H50V40H90V41H50V90H10Z"/>'),
      detail: 'detailed',
      carving: { ...carving, vBit: { ...kDefaultVBit, tipDiameter: 0.8 } },
    });
    expect(result.report.warnings.join(' ')).toContain('V-bit tip may leave');
  });

  it('checks the selected flat clearing tool when enabled', async () => {
    const result = await prepareCarvingArt({
      ...options,
      art: svg('<rect x="10" y="10" width="80" height="80"/>'),
      carving: { ...carving, clearWithFlat: true },
      clearTool: { number: 1, diameter: 3.175, name: 'Flat' },
    });
    expect(result.report.ok).toBe(true);
    expect(result.operations.some(operation => operation.tool.number === 1)).toBe(true);
  });

  it('rejects board overflow and excessive depth without changing source settings', async () => {
    const art = svg('<rect x="10" y="10" width="80" height="80"/>');
    const tooLarge = await prepareCarvingArt({ ...options, art, board: carvingBoard({ w: 20, h: 20, thickness: 18 }) });
    expect(tooLarge.report.errors.join(' ')).toContain('does not fit');
    const tooDeep = await prepareCarvingArt({ ...options, art, carving: { ...carving, maxDepth: 18 } });
    expect(tooDeep.report.errors.join(' ')).toContain('less than the board');
    expect(carving.maxDepth).toBe(2);
  });

  it('bounds synchronous CAM complexity before computing passes', async () => {
    const result = await prepareCarvingArt({ ...options, width: 500, height: 500, art: svg('<circle cx="50" cy="50" r="40"/>') });
    expect(result.report.ok).toBe(false);
    expect(result.operations).toEqual([]);
    expect(result.report.errors.join(' ')).toContain('bounded assistant CAM');
  });

  it('stops before decoding and at the scheduled preparation boundary', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      prepareCarvingArt({ ...options, art: svg('<rect width="10" height="10"/>'), signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    const next = new AbortController();
    const pending = prepareCarvingArt({ ...options, art: svg('<rect width="10" height="10"/>'), signal: next.signal });
    next.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('terminates a started CAM worker when stopped', async () => {
    const controller = new AbortController();
    const pending = checkCarvingInWorker(
      {
        id: 'stop',
        name: 'stop',
        region: [
          [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 20 },
            { x: 0, y: 20 },
          ],
        ],
        tool: kDefaultVBit,
        maxDepth: 2,
      },
      18,
      controller.signal
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects noisy raster runs before polygon union', () => {
    const mask = Uint8Array.from({ length: 100 }, (_, i) => i % 2);
    expect(() => maskOutline(mask, 10, 10, 10, 10)).toThrow('too many pixel runs');
  });

  it.each([NaN, Infinity, 0, -1, 501])('rejects invalid physical envelope %s', async width => {
    await expect(prepareCarvingArt({ ...options, art: svg('<rect width="10" height="10"/>'), width })).rejects.toThrow('2–500');
  });
});

describe('restrictive generated SVG vocabulary', () => {
  it('bounds malformed transform parsing while retaining ordinary transform lists', () => {
    const sanitizeTransform = (transform: string) => sanitizeCarvingSvg(`<svg viewBox="0 0 10 10"><g transform="${transform}"/></svg>`);
    expect(sanitizeTransform(' translate(1, 2) scale(2) rotate(45 1 1) ')).toContain('rotate(45 1 1)');
    expect(() => sanitizeTransform(`${'scale(&#9;) '.repeat(5000)}!`)).toThrow('Invalid artwork transform');
    for (const transform of ['', 'scale(1', 'scale((1))', 'scale(1) garbage', 'scale(1))']) {
      expect(() => sanitizeTransform(transform)).toThrow('Invalid artwork transform');
    }
  });

  it.each([
    '<image href="https://example.com/x.png"/>',
    '<script>alert(1)</script>',
    '<foreignObject><div/></foreignObject>',
    '<use href="#x"/>',
    '<rect width="10" height="10" onload="alert(1)"/>',
    '<rect width="10" height="10" style="fill:url(https://example.com/x)"/>',
    '<rect width="10" height="10" fill="url(#x)"/>',
    '<animate attributeName="x"/>',
    '<path d="M1e999 0L1 1Z"/>',
    '<rect transform="scale(1e999)" width="10" height="10"/>',
    '<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>',
  ])('rejects active, linked, styled or nested markup before image decode: %s', content => {
    const art = svg(content);
    if (art.kind !== 'svg') throw new Error('expected svg');
    expect(() => sanitizeCarvingSvg(art.svg)).toThrow();
  });

  it('rejects document declarations, enormous aspect ratios and shape counts', () => {
    expect(() => sanitizeCarvingSvg('<!DOCTYPE svg><svg viewBox="0 0 10 10"/>')).toThrow();
    expect(() => sanitizeCarvingSvg('<svg viewBox="0 0 100000 1"/>')).toThrow('proportions');
    const art = svg('<rect width="1" height="1"/>'.repeat(301));
    if (art.kind !== 'svg') throw new Error('expected svg');
    expect(() => sanitizeCarvingSvg(art.svg)).toThrow('too many');
  });
});
