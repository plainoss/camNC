import { describe, expect, it } from 'vitest';
import owl from './fixtures/owl-reading.svg?raw';
import mouse from './fixtures/mouse-ball.svg?raw';
import { carvingBoard, kDefaultVBit } from '../carving';
import { prepareCarvingArt, type CarvingDetail } from './prepare';
import matrixReport from './fixtures/preparation-matrix.json';

const fixtures = [
  ['owl reading a book', owl],
  ['mouse playing with a ball', mouse],
] as const;
const cases = fixtures.flatMap(([name, svg]) =>
  [40, 80, 150].flatMap(size => (['simple', 'balanced', 'detailed'] as CarvingDetail[]).map(detail => ({ name, svg, size, detail })))
);

// Recorded original sources from explicitly budgeted live generation; ordinary tests never call a paid provider.
describe('recorded generated carving illustrations', () => {
  it.each(cases)('prepares $name at $size mm with $detail detail', async ({ name, svg, size, detail }) => {
    const result = await prepareCarvingArt({
      art: { kind: 'svg', fileName: `${name}.svg`, svg },
      width: size,
      height: size,
      detail,
      carving: { items: [], region: [], vBit: kDefaultVBit, maxDepth: 2, clearWithFlat: false },
      board: carvingBoard({ w: 200, h: 200, thickness: 18 }),
    });
    expect(matrixReport.runs.some(run => run.name === name && run.size === size && run.detail === detail)).toBe(true);
    expect(result.report.errors).toEqual([]);
    expect(result.report.ok).toBe(true);
    expect(result.width).toBeLessThanOrEqual(size + 0.001);
    expect(result.height).toBeLessThanOrEqual(size + 0.001);
    expect(Math.max(result.width, result.height)).toBeGreaterThan(size * 0.93);
    expect(result.report.points).toBeLessThanOrEqual(4000);
    expect(result.report.removedComponents).toBeLessThanOrEqual(result.report.sourceComponents / 2);
    expect(result.report.removedCutAreaFraction).toBeLessThan(0.5);
    if (size === 40 && detail === 'simple') expect(result.report.warnings.join(' ')).toContain('Detail preparation removed');
    if ((result.report.removedCutAreaFraction ?? 0) > 0.1)
      expect(result.report.warnings.join(' ')).toContain('Important features may be missing');
    expect(result.report.camPasses).toBeGreaterThan(0);
    expect(result.operations.length).toBeGreaterThan(0);
    expect(svg).not.toBe(result.art.kind === 'svg' ? result.art.svg : '');
  });
});
