import { describe, expect, it } from 'vitest';
import { draggedDepth, heightOnAxis } from './partViewDrag';

describe('dragging a region’s depth', () => {
  it('reads the height where a ray passes the axis', () => {
    const d = Math.SQRT1_2;
    expect(heightOnAxis({ x: 0, y: -10, z: 15 }, { x: 0, y: d, z: -d }, { x: 0, y: 0 })).toBeCloseTo(5, 6);
    expect(heightOnAxis({ x: 3, y: -10, z: 5 }, { x: 0, y: 1, z: 0 }, { x: 3, y: 0 })).toBeCloseTo(5, 6);
  });

  it('can’t read a height looking straight down the axis', () => {
    expect(heightOnAxis({ x: 0, y: 0, z: 100 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 0 })).toBeNull();
  });

  it('snaps to half millimetres, stops at the surface, and cuts through at the bottom', () => {
    expect(draggedDepth(4, -2.2, 18)).toBe(6);
    expect(draggedDepth(4, 2.4, 18)).toBe(1.5);
    expect(draggedDepth(4, 10, 18)).toBe(0);
    expect(draggedDepth(4, -14, 18)).toBe('through');
    expect(draggedDepth(4, -100, 18)).toBe('through');
  });

  it('starts a through cut from the full thickness', () => {
    expect(draggedDepth('through', 3, 18)).toBe(15);
  });
});
