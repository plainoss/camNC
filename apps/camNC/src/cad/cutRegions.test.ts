import type { CadCutDepth } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { exposedHeightAt, type CutRegion } from './cutRegions';

const square = (x: number, y: number, size: number) => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];
const entry = (depth: CadCutDepth, points: { x: number; y: number }[], holes: { x: number; y: number }[][] = []) =>
  ({ depth, inProfile: false, sketchId: 's', region: { id: `${points[0]!.x}`, points, holes, curveIds: [] } }) as unknown as CutRegion;

describe('the height a point is really at', () => {
  it('is the top where nothing is cut', () => {
    expect(exposedHeightAt([entry(0, square(0, 0, 50))], 18, { x: 10, y: 10 })).toBe(18);
    expect(exposedHeightAt([], 18, { x: 10, y: 10 })).toBe(18);
  });

  it('is the deepest cut where regions from separate sketches overlap', () => {
    const uncut = entry(0, square(0, 0, 50)),
      pocket = entry(6, square(10, 10, 20));
    expect(exposedHeightAt([uncut, pocket], 18, { x: 15, y: 15 })).toBe(12);
    expect(exposedHeightAt([uncut, pocket], 18, { x: 40, y: 40 })).toBe(18);
    expect(exposedHeightAt([uncut, entry('through', square(10, 10, 20))], 18, { x: 15, y: 15 })).toBe(0);
  });

  it('leaves an island at its own height', () => {
    const pocket = entry(6, square(0, 0, 50), [square(20, 20, 10)]);
    expect(exposedHeightAt([pocket], 18, { x: 25, y: 25 })).toBe(18);
    expect(exposedHeightAt([pocket], 18, { x: 5, y: 5 })).toBe(12);
  });
});
