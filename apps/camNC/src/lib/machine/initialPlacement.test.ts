import { describe, expect, it } from 'vitest';
import { initialToolpathOffset, placedExtent } from './initialPlacement';

const bed = { min: { x: 3, y: 3 }, max: { x: 621, y: 1241 } };

describe('initialToolpathOffset', () => {
  it('moves a board that fits just far enough to lie on the bed', () => {
    const extent = placedExtent({ min: { x: 0, y: 0 }, max: { x: 588.39, y: 1194.39 } }, { w: 594, h: 1200, rotationDeg: 0 });
    expect(initialToolpathOffset({ x: 150, y: 220 }, extent, bed)).toEqual({ x: 27, y: 41 });
    expect(initialToolpathOffset({ x: -50, y: 10 }, extent, bed)).toEqual({ x: 3, y: 10 });
  });

  it('keeps the zero on an axis the board is longer than the bed', () => {
    const extent = placedExtent({ min: { x: 0, y: 0 }, max: { x: 100, y: 1300 } }, { w: 100, h: 1300, rotationDeg: 0 });
    expect(initialToolpathOffset({ x: 600, y: 220 }, extent, bed)).toEqual({ x: 521, y: 220 });
  });

  it('counts a turned board by its outline on the bed', () => {
    const extent = placedExtent({ min: { x: -1200, y: 0 }, max: { x: 0, y: 594 } }, { w: 594, h: 1200, rotationDeg: 90 })!;
    expect(extent.min.x).toBeCloseTo(-1200);
    expect(extent.max.y).toBeCloseTo(594);
  });

  it('keeps the zero without bounds or moves', () => {
    expect(initialToolpathOffset({ x: 150, y: 220 }, null, bed)).toEqual({ x: 150, y: 220 });
    const empty = { min: { x: Infinity, y: Infinity }, max: { x: -Infinity, y: -Infinity } };
    expect(placedExtent(empty)).toBeNull();
    expect(initialToolpathOffset({ x: 150, y: 220 }, placedExtent({ min: { x: 0, y: 0 }, max: { x: 10, y: 10 } }), null)).toEqual({
      x: 150,
      y: 220,
    });
  });
});
