import { featuresFromCuts, type FlatCut, type FlatProfile } from '@wbcnc/cam';
import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry, EdgesGeometry } from 'three';
import { cutPartMesh } from './cutPartMesh';

const rect = (x: number, y: number, width: number, height: number) => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + height },
  { x, y: y + height },
];
const circle = (x: number, y: number, radius: number, count = 64) =>
  Array.from({ length: count }, (_, i) => ({
    x: x + radius * Math.cos((i * 2 * Math.PI) / count),
    y: y + radius * Math.sin((i * 2 * Math.PI) / count),
  }));
const pocket = (id: string, outline: FlatCut['outline'], to: number, extra: Partial<FlatCut> = {}): FlatCut => ({
  id,
  outline,
  to,
  from: 0,
  through: false,
  islands: [],
  ...extra,
});

/** Vertical triangles crossing a particular XY window, independent of the feature extraction/readback. */
function wallsIn(positions: Float64Array, within: (x: number, y: number) => boolean) {
  const walls: { low: number; high: number }[] = [];
  for (let i = 0; i < positions.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = positions.subarray(i, i + 9) as unknown as number[];
    const xyArea = Math.abs((bx! - ax!) * (cy! - ay!) - (by! - ay!) * (cx! - ax!));
    const low = Math.min(az!, bz!, cz!),
      high = Math.max(az!, bz!, cz!);
    if (xyArea < 1e-8 && high - low > 1e-4 && within((ax! + bx! + cx!) / 3, (ay! + by! + cy!) / 3)) walls.push({ low, high });
  }
  return walls;
}

function expectClosedBoundary(positions: Float64Array) {
  const edges = new Map<string, { count: number; direction: number }>();
  for (let i = 0; i < positions.length; i += 9) {
    const vertices = [0, 3, 6].map(offset => [...positions.subarray(i + offset, i + offset + 3)].map(n => n.toFixed(5)).join(','));
    for (let j = 0; j < 3; j++) {
      const a = vertices[j]!,
        b = vertices[(j + 1) % 3]!,
        key = [a, b].sort().join('|'),
        previous = edges.get(key) ?? { count: 0, direction: 0 };
      edges.set(key, { count: previous.count + 1, direction: previous.direction + (a < b ? 1 : -1) });
    }
  }
  expect([...edges.values()].filter(edge => edge.count !== 2 || edge.direction !== 0)).toEqual([]);
}

describe('the boundary of a part with curved cut outlines', () => {
  it.each([6, 9, 12])('keeps one closed boundary when opposite-face pocket depths are %s mm', depth => {
    const outline = circle(50, 40, 40),
      top = featuresFromCuts({ thickness: 18, outline, holes: [], cuts: [pocket('top', rect(30, 30, 10, 20), depth)] }).features,
      below = featuresFromCuts({ thickness: 18, outline, holes: [], cuts: [pocket('below', rect(60, 30, 10, 20), depth)] }).features,
      { positions, indices } = cutPartMesh(top, below);
    expectClosedBoundary(positions);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3));
    geometry.setIndex(new BufferAttribute(indices, 1));
    const edges = new EdgesGeometry(geometry, 20),
      lines = edges.getAttribute('position');
    // Pocket floors retain their outlines; an uninterrupted curved outside wall has no horizontal seams.
    const outer = (i: number) => Math.hypot(lines.getX(i) - 50, lines.getY(i) - 40) > 39;
    const seams = [];
    for (let i = 0; i < lines.count; i += 2)
      if (outer(i) && outer(i + 1) && lines.getZ(i) === lines.getZ(i + 1) && lines.getZ(i) > 0 && lines.getZ(i) < 18) seams.push(i);
    expect(seams).toEqual([]);
    expect(lines.count).toBeGreaterThan(2 * outline.length * 2);
    edges.dispose();
    geometry.dispose();
  });

  it('keeps a circular island wall above the surrounding pocket floor', () => {
    const profile: FlatProfile = {
      thickness: 18,
      outline: rect(0, 0, 100, 80),
      holes: [],
      cuts: [pocket('recess', rect(20, 10, 60, 60), 6, { islands: [circle(50, 40, 5)] })],
    };
    const { features } = featuresFromCuts(profile),
      { positions } = cutPartMesh(features),
      islandWalls = wallsIn(positions, (x, y) => x > 40 && x < 60 && y > 30 && y < 50);
    expect(islandWalls.length).toBeGreaterThan(20);
    // There is uninterrupted material below z=12; a seam between independently simplified caps must not become a wall.
    expect(islandWalls.every(wall => wall.low >= 12 - 1e-6)).toBe(true);
    expect(islandWalls.every(wall => wall.high <= 18 + 1e-6)).toBe(true);
    expectClosedBoundary(positions);
  });

  it('keeps a round cut from a pocket floor above its own deeper floor', () => {
    const profile: FlatProfile = {
      thickness: 24,
      outline: rect(0, 0, 260, 160),
      holes: [],
      cuts: [pocket('recess', rect(15, 15, 230, 130), 8), pocket('round-floor-cut', circle(130, 80, 30, 128), 14, { from: 8 })],
    };
    const { features } = featuresFromCuts(profile),
      { positions } = cutPartMesh(features),
      roundWalls = wallsIn(positions, (x, y) => x > 95 && x < 165 && y > 45 && y < 115);
    expect(roundWalls.length).toBeGreaterThan(100);
    // The round cut stops at z=10; no part of its boundary belongs inside the solid below it.
    expect(roundWalls.every(wall => wall.low >= 10 - 1e-6)).toBe(true);
    expect(roundWalls.every(wall => wall.high <= 16 + 1e-6)).toBe(true);
    expectClosedBoundary(positions);
  });

  it('closes the same curved island boundary when the pocket is cut from underneath', () => {
    const outline = rect(0, 0, 100, 80),
      { features: top } = featuresFromCuts({ thickness: 18, outline, holes: [], cuts: [] }),
      { features: below } = featuresFromCuts({
        thickness: 18,
        outline,
        holes: [],
        cuts: [pocket('recess', rect(20, 10, 60, 60), 6, { islands: [circle(50, 40, 5)] })],
      }),
      { positions } = cutPartMesh(top, below),
      islandWalls = wallsIn(positions, (x, y) => x > 40 && x < 60 && y > 30 && y < 50);
    expect(islandWalls.length).toBeGreaterThan(20);
    expect(islandWalls.every(wall => wall.low >= -1e-6 && wall.high <= 6 + 1e-6)).toBe(true);
    expectClosedBoundary(positions);
  });

  it('preserves a small through-hole in the island instead of discarding small boundary loops', () => {
    const profile: FlatProfile = {
      thickness: 18,
      outline: rect(0, 0, 100, 80),
      holes: [circle(50, 40, 0.08)],
      cuts: [pocket('recess', rect(20, 10, 60, 60), 6, { islands: [circle(50, 40, 5)] })],
    };
    const { features } = featuresFromCuts(profile),
      { positions } = cutPartMesh(features),
      boreWalls = wallsIn(positions, (x, y) => Math.hypot(x - 50, y - 40) < 0.2);
    expect(boreWalls.length).toBeGreaterThan(20);
    expect(Math.min(...boreWalls.map(wall => wall.low))).toBe(0);
    expect(Math.max(...boreWalls.map(wall => wall.high))).toBe(18);
    expectClosedBoundary(positions);
  });
});
