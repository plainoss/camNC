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

  it('keeps the inside of a frame cut into mitred pieces a hole', () => {
    let sketch = frame(createCadPart('Part 1', 18).sketch);
    for (const [x1, y1, x2, y2] of [
      [20, 0, 35, 20],
      [100, 0, 85, 20],
      [100, 70, 85, 50],
      [20, 70, 35, 50],
    ] as const)
      sketch = addLine(sketch, { x1, y1, x2, y2 });
    const regions = sketchRegions(sketch, CAD_CHORD_TOLERANCE);
    expect(regions).toHaveLength(5);
    const solid = solidSketchRegionIds(sketch);
    expect(solid).toHaveLength(4);
    const inside = regions.find(region => !solid.includes(region.id))!;
    expect(area(inside.points)).toBe(1500);
    const parts = extrudedApart(sketch).map(evaluated);
    expect(parts.map(part => area(part.outline))).toEqual([5600]);
    expect(parts[0]!.holes.map(area)).toEqual([1500]);
  });

  it('keeps the inside of a frame cut across once a hole', () => {
    const sketch = addLine(frame(createCadPart('Part 1', 18).sketch), { x1: 60, y1: 0, x2: 60, y2: 20 });
    expect(sketchRegions(sketch, CAD_CHORD_TOLERANCE)).toHaveLength(2);
    const solid = solidSketchRegionIds(sketch);
    expect(solid).toHaveLength(1);
    const profile = evaluated({ ...createCadPart('Part 1', 18), sketch, regions: solid });
    expect(area(profile.outline)).toBe(5600);
    expect(profile.holes.map(area)).toEqual([1500]);
  });

  it('keeps every piece of an overlapping pair solid', () => {
    let sketch = createCadPart('Part 1', 18).sketch;
    sketch = addRectangle(sketch, { x: 0, y: 0, width: 60, height: 40 });
    sketch = addRectangle(sketch, { x: 30, y: 20, width: 60, height: 40 });
    expect(sketchRegions(sketch, CAD_CHORD_TOLERANCE)).toHaveLength(3);
    expect(solidSketchRegionIds(sketch)).toHaveLength(3);
    const parts = extrudedApart(sketch).map(evaluated);
    expect(parts.map(part => area(part.outline))).toEqual([4200]);
    expect(parts[0]!.holes).toEqual([]);
  });

  it('keeps an island inside the hole of a mitred frame solid', () => {
    let sketch = addRectangle(frame(createCadPart('Part 1', 18).sketch), { x: 50, y: 30, width: 20, height: 10 });
    for (const [x1, y1, x2, y2] of [
      [20, 0, 35, 20],
      [100, 0, 85, 20],
      [100, 70, 85, 50],
      [20, 70, 35, 50],
    ] as const)
      sketch = addLine(sketch, { x1, y1, x2, y2 });
    expect(sketchRegions(sketch, CAD_CHORD_TOLERANCE)).toHaveLength(6);
    expect(solidSketchRegionIds(sketch)).toHaveLength(5);
    const parts = extrudedApart(sketch).map(evaluated);
    expect(parts.map(part => area(part.outline))).toEqual([5600, 200]);
    expect(parts.map(part => part.holes.map(area))).toEqual([[1500], []]);
  });

  it('cuts an overlapping pair inside a panel out of it as one hole', () => {
    let sketch = addRectangle(createCadPart('Part 1', 18).sketch, { x: 0, y: 0, width: 200, height: 100 });
    sketch = addRectangle(sketch, { x: 20, y: 20, width: 60, height: 40 });
    sketch = addRectangle(sketch, { x: 50, y: 40, width: 60, height: 40 });
    expect(sketchRegions(sketch, CAD_CHORD_TOLERANCE)).toHaveLength(4);
    const solid = solidSketchRegionIds(sketch);
    expect(solid).toHaveLength(1);
    const profile = evaluated({ ...createCadPart('Part 1', 18), sketch, regions: solid });
    expect(area(profile.outline)).toBe(20000);
    expect(profile.holes.map(area)).toEqual([4200]);
  });
});
