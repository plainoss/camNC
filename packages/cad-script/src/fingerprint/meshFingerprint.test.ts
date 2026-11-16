import { describe, expect, it } from 'vitest';
import { compareParts } from './compare';
import { fingerprintMesh, type FingerprintMesh } from './meshFingerprint';
import { pointTriangleDistanceSq, sampleSurface, surfaceDistance } from './surfaceDistance';

/** An axis-aligned box as 12 outward triangles, each face with its own vertices as STEP readers give them. */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): FingerprintMesh {
  const positions: number[] = [],
    indices: number[] = [];
  const quad = (...corners: [number, number, number][]) => {
    const first = positions.length / 3;
    positions.push(...corners.flat());
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  };
  quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]);
  quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
  quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
  quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]);
  quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
  quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]);
  return { positions, indices };
}

/** A square ring (a box with a square hole through it), genus 1, built from shared vertices. */
function ring(): FingerprintMesh {
  const outer = [
    [0, 0],
    [3, 0],
    [3, 3],
    [0, 3],
  ];
  const inner = [
    [1, 1],
    [2, 1],
    [2, 2],
    [1, 2],
  ];
  // Vertices: outer bottom 0-3, outer top 4-7, inner bottom 8-11, inner top 12-15.
  const positions = [
    ...outer.map(([x, y]) => [x!, y!, 0]),
    ...outer.map(([x, y]) => [x!, y!, 1]),
    ...inner.map(([x, y]) => [x!, y!, 0]),
    ...inner.map(([x, y]) => [x!, y!, 1]),
  ].flat();
  const indices: number[] = [];
  const quad = (a: number, b: number, c: number, d: number) => indices.push(a, b, c, a, c, d);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad(i, j, j + 4, i + 4); // outer wall, facing out
    quad(i + 8, i + 12, j + 12, j + 8); // inner wall, facing the hole
    quad(i + 4, j + 4, j + 12, i + 12); // top
    quad(i, i + 8, j + 8, j); // bottom
  }
  return { positions, indices };
}

describe('mesh fingerprint', () => {
  it('measures a unit cube', () => {
    const cube = fingerprintMesh('Cube', box(0, 0, 0, 1, 1, 1));
    expect(cube.volume).toBeCloseTo(1, 12);
    expect(cube.area).toBeCloseTo(6, 12);
    expect(cube.bbox).toEqual({ min: [0, 0, 0], max: [1, 1, 1] });
    expect(cube).toMatchObject({ genus: 0, closed: true, triangles: 12 });
  });

  it('gives a solid away from the origin the same volume, and an inside-out one a negative one', () => {
    expect(fingerprintMesh('Moved', box(10, 20, 30, 12, 21, 31)).volume).toBeCloseTo(2, 9);
    const cube = box(0, 0, 0, 1, 1, 1);
    const inverted = { positions: cube.positions, indices: Array.from(cube.indices).reverse() };
    expect(fingerprintMesh('Inverted', inverted).volume).toBeCloseTo(-1, 12);
  });

  it('counts a hole through the part as genus 1, and two separate cubes as genus 0', () => {
    const ringPrint = fingerprintMesh('Ring', ring());
    expect(ringPrint).toMatchObject({ genus: 1, closed: true });
    expect(ringPrint.volume).toBeCloseTo(8, 12);
    const a = box(0, 0, 0, 1, 1, 1),
      b = box(5, 0, 0, 6, 1, 1);
    const two = {
      positions: [...Array.from(a.positions), ...Array.from(b.positions)],
      indices: [...Array.from(a.indices), ...Array.from(b.indices, i => i + 24)],
    };
    expect(fingerprintMesh('Two', two)).toMatchObject({ genus: 0, closed: true });
  });

  it('welds vertices a rounding apart, and reports a missing face as open', () => {
    const cube = box(0, 0, 0, 1, 1, 1);
    const jittered = { ...cube, positions: Array.from(cube.positions, (v, i) => v + (i % 2 ? 1e-9 : -1e-9)) };
    expect(fingerprintMesh('Jittered', jittered)).toMatchObject({ genus: 0, closed: true });
    expect(fingerprintMesh('Open', { ...cube, indices: Array.from(cube.indices).slice(6) }).closed).toBe(false);
  });
});

describe('surface distance', () => {
  it('measures to a triangle’s face, edge and corner', () => {
    const a: [number, number, number] = [0, 0, 0],
      b: [number, number, number] = [1, 0, 0],
      c: [number, number, number] = [0, 1, 0];
    expect(pointTriangleDistanceSq([0.2, 0.2, 3], a, b, c)).toBeCloseTo(9, 12);
    expect(pointTriangleDistanceSq([0.5, -2, 0], a, b, c)).toBeCloseTo(4, 12);
    expect(pointTriangleDistanceSq([-1, -1, 0], a, b, c)).toBeCloseTo(2, 12);
    expect(pointTriangleDistanceSq([1, 1, 0], a, b, c)).toBeCloseTo(0.5, 12);
  });

  it('samples the same points every time, spread over the area', () => {
    const cube = box(0, 0, 0, 1, 1, 1);
    expect(sampleSurface(cube, 50, 7)).toEqual(sampleSurface(cube, 50, 7));
    const points = sampleSurface(box(0, 0, 0, 10, 10, 0.1), 2000);
    // The two big faces hold almost all of the area.
    expect(points.filter(p => Math.abs(p[2] - 0.05) > 0.05 - 1e-12).length).toBeGreaterThan(1900);
  });

  it('finds no gap between a cube and itself, and the shift between moved cubes', () => {
    const cube = box(0, 0, 0, 1, 1, 1);
    expect(surfaceDistance(cube, cube, 2000).max).toBeLessThan(1e-12);
    const moved = surfaceDistance(cube, box(0.3, 0, 0, 1.3, 1, 1), 5000);
    expect(moved.max).toBeCloseTo(0.3, 2);
    expect(moved.mean).toBeGreaterThan(0);
  });

  it('measures points far outside the other mesh', () => {
    expect(surfaceDistance(box(0, 0, 0, 1, 1, 1), box(10, 0, 0, 11, 1, 1), 500).max).toBeCloseTo(10, 6);
  });
});

describe('comparing fingerprints', () => {
  const part = (name: string, mesh: FingerprintMesh) => ({ fingerprint: fingerprintMesh(name, mesh), mesh });

  it('matches parts by volume whatever their order', () => {
    const small = box(0, 0, 0, 1, 1, 1),
      big = box(5, 0, 0, 8, 1, 1);
    const result = compareParts([part('Small', small), part('Big', big)], [part('B', big), part('S', small)], {
      volumePercent: 0.1,
      bbox: 0.01,
      distance: 0.05,
      samples: 1000,
    });
    expect(result.failures).toEqual([]);
    expect(result.equal).toBe(true);
    expect(result.parts.map(p => [p.expected, p.actual])).toEqual([
      ['Small', 'S'],
      ['Big', 'B'],
    ]);
  });

  it('fails a different part count and names the part left over', () => {
    const cube = box(0, 0, 0, 1, 1, 1);
    const result = compareParts([part('A', cube), part('B', box(0, 0, 0, 2, 1, 1))], [part('A', cube)]);
    expect(result.equal).toBe(false);
    expect(result.unmatched).toEqual([{ side: 'expected', name: 'B', volume: 2 }]);
    expect(result.failures[0]).toMatch(/Expected 2 parts, got 1/);
  });

  it('skips the surface check against a saved fingerprint, which has no mesh', () => {
    const cube = box(0, 0, 0, 1, 1, 1);
    const result = compareParts([{ fingerprint: fingerprintMesh('A', cube) }], [part('A', cube)]);
    expect(result.equal).toBe(true);
    expect(result.parts[0]!.distance).toBeNull();
  });
});
