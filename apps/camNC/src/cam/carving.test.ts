import { describe, expect, it } from 'vitest';
import { boardRequest, edgeNote, nestBoard, reconcileBoards } from './boards';
import { boardCarving, carvingProblem, hasWork, kDefaultVBit, withCarving, type CarvingV1 } from './carving';
import { maskOutline, outlineArt } from './carvingOutline';
import { camWorker } from './camQueries';
import { createCarvingJob, modelKey } from './jobDb';
import { firstStage } from './openModelFile';
import { kDefaultPlan, toCamSettings } from './planSettings';

type Loop = { x: number; y: number }[];
const area = (loop: Loop) => loop.reduce((s, p, i) => s + p.x * loop[(i + 1) % loop.length].y - loop[(i + 1) % loop.length].x * p.y, 0) / 2;
const box = (region: Loop[]) => {
  const pts = region.flat();
  return {
    w: Math.max(...pts.map(p => p.x)) - Math.min(...pts.map(p => p.x)),
    h: Math.max(...pts.map(p => p.y)) - Math.min(...pts.map(p => p.y)),
  };
};

describe('carving outlines', () => {
  it('turn a pixel mask into a few straight lines, mm, centred, Y up', () => {
    // A 20 × 10 px block in a 40 × 20 px image, at 10 px/mm: 2 × 1 mm, its top left a quarter in.
    const w = 40,
      h = 20;
    const ink = new Uint8Array(w * h);
    for (let y = 5; y < 15; y++) for (let x = 10; x < 30; x++) ink[y * w + x] = 1;
    const [loop, ...rest] = maskOutline(ink, w, h, 10);
    expect(rest).toEqual([]);
    expect(loop).toHaveLength(4);
    expect(Math.abs(area(loop))).toBeCloseTo(2);
    expect(box([loop])).toEqual({ w: 2, h: 1 });
  });

  it('draw lettering at the height asked for, with the hole of an O as a hole', async () => {
    const { region, height } = await outlineArt({ kind: 'text', text: 'O', font: 'sans' }, 40);
    expect(height).toBe(40);
    expect(box(region).h).toBeGreaterThan(39.5);
    expect(box(region).h).toBeLessThan(40.5);
    expect(region).toHaveLength(2);
    // One loop each way round: the inside of the O stays uncut.
    expect(Math.sign(area(region[0]))).not.toBe(Math.sign(area(region[1])));
  });

  it('draw an SVG’s filled shapes at its own proportions', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10" viewBox="0 0 20 10"><rect width="20" height="10"/></svg>';
    const { region, width } = await outlineArt({ kind: 'svg', svg, fileName: 'bar.svg' }, 10);
    expect(width).toBeCloseTo(20);
    expect(Math.abs(region.reduce((s, l) => s + area(l), 0))).toBeCloseTo(200, -1);
  });

  it.each([
    ['viewBox only', 'viewBox="0 0 200 100"', 100],
    ['physical units', 'width="50mm" height="25mm" viewBox="0 0 50 25"', 25],
    ['percentage units', 'width="100%" height="100%" viewBox="0 0 200 100"', 100],
    ['numeric dimensions', 'width="200" height="100"', 100],
    ['only width and a viewBox', 'width="300" viewBox="0 0 200 100"', 100],
    ['only height and a viewBox', 'height="300" viewBox="0 0 200 100"', 100],
  ])('draws a half-filled SVG with %s at the requested proportions', async (_, attributes, size) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}><rect width="${size}" height="${size}"/></svg>`;
    const { region, width, height } = await outlineArt({ kind: 'svg', svg, fileName: 'half.svg' }, 20);
    expect(width).toBeCloseTo(40);
    expect(height).toBe(20);
    expect(region).toHaveLength(1);
    expect(box(region).w).toBeCloseTo(20, 1);
    expect(box(region).h).toBeCloseTo(20, 1);
  });

  it.each([
    ['50mm', '25mm', (25 * 96) / 25.4],
    ['5cm', '2.5cm', (25 * 96) / 25.4],
    ['2in', '1in', 96],
    ['144pt', '72pt', 96],
    ['12pc', '6pc', 96],
    ['200Q', '100Q', (25 * 96) / 25.4],
    ['192px', '96px', 96],
  ])('keeps user coordinates in pixels for an SVG sized %s by %s without a viewBox', async (sourceWidth, sourceHeight, sourceHeightPx) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sourceWidth}" height="${sourceHeight}"><rect x="100" y="20" width="50" height="50"/></svg>`;
    const { region, width, height } = await outlineArt({ kind: 'svg', svg, fileName: 'physical.svg' }, 20);
    expect(width).toBeCloseTo(40);
    expect(height).toBe(20);
    expect(region).toHaveLength(1);
    const expectedSize = (50 / sourceHeightPx) * 20;
    expect(box(region).w).toBeCloseTo(expectedSize, 0);
    expect(box(region).h).toBeCloseTo(expectedSize, 0);
  });

  it('preserves an explicit viewport that stretches a viewBox circle into an ellipse', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 100 100" preserveAspectRatio="none"><circle cx="50" cy="50" r="40"/></svg>';
    const { region, width } = await outlineArt({ kind: 'svg', svg, fileName: 'ellipse.svg' }, 20);
    expect(width).toBeCloseTo(40);
    expect(region).toHaveLength(1);
    expect(box(region).w).toBeCloseTo(32, 1);
    expect(box(region).h).toBeCloseTo(16, 1);
  });

  it.each([
    'width="100%" height="50%"',
    'width="200"',
    'width="20em" height="10em"',
    'width="20pxjunk" height="10px"',
    'width="0" height="10"',
  ])('rejects an SVG without a usable viewport or viewBox: %s', async attributes => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}><rect width="10" height="10"/></svg>`;
    await expect(outlineArt({ kind: 'svg', svg, fileName: 'invalid-size.svg' }, 10)).rejects.toThrow(/could not be read/);
  });

  it('rejects a file whose root is not SVG', async () => {
    await expect(outlineArt({ kind: 'svg', svg: '<html/>', fileName: 'x.svg' }, 10)).rejects.toThrow(/not an SVG/);
  });

  it('say why an SVG cannot be read', async () => {
    await expect(outlineArt({ kind: 'svg', svg: '<not svg', fileName: 'x.svg' }, 10)).rejects.toThrow(/could not be read/);
  });
});

describe('a carving job', () => {
  it('starts with lettering on a fixed board, opens on Carve, and has no model file', async () => {
    const job = await createCarvingJob();
    expect(job.carving?.region.length).toBeGreaterThan(0);
    expect(job.carving?.vBit).toEqual(kDefaultVBit);
    expect(kDefaultVBit).toMatchObject({ shape: 'v', angle: 90, diameter: 6 });
    expect(job.boards?.[0].size).toEqual({ fit: false, w: 300, h: 140 });
    expect(modelKey(job)).toBe(`${job.id}:carving`);
    expect(firstStage(job)).toBe('/cam/$jobId/carve');
  });

  it('says what keeps it from being planned', () => {
    const carving = { art: { kind: 'text', text: ' ', font: 'sans' }, region: [] } as unknown as CarvingV1;
    expect(carvingProblem(carving, { thickness: 18 })).toMatch(/Type something/);
    expect(carvingProblem({ ...carving, art: { kind: 'text', text: 'A', font: 'sans' } }, { thickness: 18 })).toMatch(/no filled shapes/);
  });

  it('clears flat bottoms with the job’s flat bit only when asked', async () => {
    const job = await createCarvingJob();
    expect(boardCarving(job.carving!, kDefaultPlan).clearTool).toEqual(kDefaultPlan.bit);
    expect(boardCarving({ ...job.carving!, clearWithFlat: false }, kDefaultPlan).clearTool).toBeUndefined();
  });

  it('plans its board in the worker: V-carving, with nothing unsafe', async () => {
    const job = await createCarvingJob();
    const [board] = reconcileBoards(job.boards, [], 'oak');
    const nest = nestBoard(board, [], kDefaultPlan.bit.diameter);
    const request = withCarving(boardRequest(board, nest, []), job);
    expect(request.parts).toEqual([]);
    expect(hasWork(request)).toBe(true);
    expect(hasWork(boardRequest(board, nest, []))).toBe(false);
    const plan = await camWorker().generateBoard(modelKey(job), request, toCamSettings(kDefaultPlan, 'oak'), { perPart: false });
    expect(plan.safety).toEqual([]);
    expect(plan.ops.some(op => op.kind === 'vcarve' && op.tool.shape === 'v')).toBe(true);
    expect(plan.programs.at(-1)).toMatchObject({ tool: kDefaultVBit.number, name: kDefaultVBit.name });
    expect(plan.gcode).toMatch(/TAPER=45deg/);
    // Its board has no outlines: no note about cuts past its edge.
    expect(edgeNote(board, nest, kDefaultPlan.bit.diameter)).toBeNull();
  }, 60_000);
});
