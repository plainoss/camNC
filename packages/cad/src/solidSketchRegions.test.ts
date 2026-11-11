import { describe, expect, it } from 'vitest';
import {
  addCircle,
  addLine,
  addRectangle,
  CAD_CHORD_TOLERANCE,
  createCadDocument,
  createCadPart,
  evaluateCadPart,
  polygonArea,
  sketchRegions,
  solidSketchRegionIds,
  splitApartRegions,
  type CadPart,
  type CadSketch,
} from './index';

const area = (points: { x: number; y: number }[]) => Math.abs(polygonArea(points));

/** A frame: an 80 × 70 rectangle with a 50 × 30 one inside it, whose hole covers the middle of its outline. */
const frame = (sketch: CadSketch) =>
  addRectangle(addRectangle(sketch, { x: 20, y: 0, width: 80, height: 70 }), { x: 35, y: 20, width: 50, height: 30 });

/** The sketch's solid regions, each group apart split into a part of its own, as a New extrude's OK does. */
function extrudedApart(sketch: CadSketch): CadPart[] {
  const part: CadPart = { ...createCadPart('Part 1', 18), sketch, regions: solidSketchRegionIds(sketch) };
  return splitApartRegions({ ...createCadDocument(), parts: [part] }, part.id).parts;
}

function evaluated(part: CadPart) {
  const { part: profile, diagnostics } = evaluateCadPart(part);
  expect(diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  return profile!;
}

describe('the solid regions of a sketch of shapes apart', () => {
  it('keeps a frame and its hole beside a rectangle', () => {
    const sketch = frame(addRectangle(createCadPart('Part 1', 18).sketch, { x: -100, y: 10, width: 60, height: 50 }));
    expect(sketchRegions(sketch, CAD_CHORD_TOLERANCE)).toHaveLength(3);
    expect(solidSketchRegionIds(sketch)).toHaveLength(2);
    const parts = extrudedApart(sketch).map(evaluated);
    expect(parts).toHaveLength(2);
    expect(parts.map(part => area(part.outline))).toEqual([3000, 5600]);
    expect(parts.map(part => part.holes.map(area))).toEqual([[], [1500]]);
  });

  it('keeps a frame beside an overlapping pair and a circle', () => {
    let sketch = createCadPart('Part 1', 18).sketch;
    sketch = addRectangle(sketch, { x: -200, y: 0, width: 60, height: 40 });
    sketch = addRectangle(sketch, { x: -170, y: 20, width: 60, height: 40 });
    sketch = frame(sketch);
    sketch = addCircle(sketch, { x: 160, y: 30, radius: 20 });
    // The pair is three regions, the frame two, the circle one: all but the frame's inside are solid.
    expect(sketchRegions(sketch, CAD_CHORD_TOLERANCE)).toHaveLength(6);
    expect(solidSketchRegionIds(sketch)).toHaveLength(5);
    const parts = extrudedApart(sketch).map(evaluated);
    expect(parts).toHaveLength(3);
    const framed = parts.find(part => part.holes.length)!;
    expect(area(framed.outline)).toBeCloseTo(5600, 6);
    expect(framed.holes.map(area)).toEqual([1500]);
  });

  it('is the frame with its hole when it’s alone', () => {
    const sketch = frame(createCadPart('Part 1', 18).sketch);
    const solid = solidSketchRegionIds(sketch);
    expect(solid).toHaveLength(1);
    const profile = evaluated({ ...createCadPart('Part 1', 18), sketch, regions: solid });
    expect(area(profile.outline)).toBe(5600);
    expect(profile.holes.map(area)).toEqual([1500]);
  });

  it('keeps an island inside a hole solid', () => {
    const sketch = addRectangle(frame(createCadPart('Part 1', 18).sketch), { x: 50, y: 30, width: 20, height: 10 });
    expect(solidSketchRegionIds(sketch)).toHaveLength(2);
    const parts = extrudedApart(sketch).map(evaluated);
    expect(parts.map(part => area(part.outline))).toEqual([5600, 200]);
    expect(parts.map(part => part.holes.map(area))).toEqual([[1500], []]);
  });

  // #724: a hole bounded only by other regions, as the inside of a frame cut into mitred pieces is, should stay a hole.
  it('extrudes a frame cut into mitred pieces solid, its inside too, for now', () => {
    let sketch = frame(createCadPart('Part 1', 18).sketch);
    for (const [x1, y1, x2, y2] of [
      [20, 0, 35, 20],
      [100, 0, 85, 20],
      [100, 70, 85, 50],
      [20, 70, 35, 50],
    ] as const)
      sketch = addLine(sketch, { x1, y1, x2, y2 });
    expect(sketchRegions(sketch, CAD_CHORD_TOLERANCE)).toHaveLength(5);
    expect(solidSketchRegionIds(sketch)).toHaveLength(5);
    const parts = extrudedApart(sketch).map(evaluated);
    expect(parts.map(part => area(part.outline))).toEqual([5600]);
    expect(parts[0]!.holes).toEqual([]);
  });
});
