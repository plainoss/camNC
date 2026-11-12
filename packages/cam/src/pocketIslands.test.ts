import { describe, expect, it } from 'vitest';
import type { PartFeatures } from './features';
import { difference, polyArea, type PathD, type PathsD } from './geom';
import { camPart } from './toolpaths';

const rect = (x0: number, y0: number, x1: number, y1: number): PathD => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const square = (cx: number, cy: number, h: number) => rect(cx - h, cy - h, cx + h, cy + h);

function pocketPart(outline: PathD, region: PathsD, depth: number): PartFeatures {
  const upper = difference([outline], region);
  return {
    thickness: 18,
    outlines: [outline],
    footprint: [outline],
    throughHoles: [],
    levels: [{ z: 18, region: upper, area: polyArea(upper) }],
    pockets: [{ floorZ: 18 - depth, region, strictRegion: region, above: upper, area: polyArea(region) }],
    bottomFaces: [],
    slopedArea: 0,
  };
}

/** A pocket round a grid of small islands: its rings split between them into many regions, each roughed on its own. */
const islands: PathD[] = [];
for (let i = 0; i < 9; i++) for (let j = 0; j < 6; j++) islands.push(square(40 + i * 28, 40 + j * 30, 4 + ((i + j) % 3)));
const manyIslands = pocketPart(rect(0, 0, 320, 240), difference([rect(20, 20, 290, 210)], islands), 6);

/** Fixed arithmetic, allocation and sorting work, independent of the planner. */
function referenceWork() {
  let sum = 0;
  for (let k = 0; k < 400; k++) {
    const rects = Array.from({ length: 400 }, (_, i) => ({ x: (i * 7919 + k) % 1009, w: (i * 104729) % 613 }));
    rects.sort((a, b) => a.x - b.x || a.w - b.w);
    for (const r of rects) sum += Math.min(r.x + r.w, 1000);
  }
  return sum;
}
/**
 * Planning takes about 200 reference runs, 180 before lobes were roughed one at a time. Checking each link against every
 * sweep cut so far, rather than the ones near it, took 320.
 */
const kIslandsRatio = 260;

describe('pocket with many islands', () => {
  it('[performance] plans within a fixed multiple of reference work', () => {
    const timed = (run: () => unknown) => {
      const t = performance.now();
      run();
      return performance.now() - t;
    };
    const work = () => camPart(manyIslands, { cutThrough: false });
    // Alternating order, median ratio: changing runner load favours neither.
    const ratios = Array.from({ length: 3 }, (_, i) => {
      if (i % 2) {
        const r = timed(referenceWork);
        return timed(work) / r;
      }
      const w = timed(work);
      return w / timed(referenceWork);
    }).sort((a, b) => a - b);
    console.info(`pocket with many islands: median ratio ${ratios[1].toFixed(2)} of reference work`);
    expect(ratios[1]).toBeLessThan(kIslandsRatio);
  });
});
