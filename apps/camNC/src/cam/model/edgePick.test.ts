import { describe, expect, it } from 'vitest';
import { nearestEdge } from './edgePick';

// A 100 × 60 × 40 box, its top split into four triangles meeting in the middle of its long edges.
const positions = new Float32Array([
  0, 0, 0, 100, 0, 0, 100, 60, 0, 0, 60, 0, 0, 0, 40, 100, 0, 40, 100, 60, 40, 0, 60, 40, 50, 0, 40, 50, 60, 40,
]);
// prettier-ignore
const indices = [
  0, 2, 1, 0, 3, 2, // bottom
  4, 8, 9, 4, 9, 7, 8, 5, 6, 8, 6, 9, // top, in two halves
  0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7, // sides
];

describe('picking an edge', () => {
  it('gives the whole edge near a click, joined across the pieces the mesh splits it into', () => {
    const edge = nearestEdge(positions, indices, [30, 1, 40], 2)!;
    const ends = [edge.a, edge.b].map(p => p.join(',')).sort();
    expect(ends).toEqual(['0,0,40', '100,0,40']);
  });

  it('finds none when the click is away from every edge', () => {
    expect(nearestEdge(positions, indices, [50, 30, 40], 2)).toBeNull();
  });

  it('leaves out lines across a flat face', () => {
    // The line splitting the top in two is no edge.
    const edge = nearestEdge(positions, indices, [50, 30.5, 40], 31);
    expect(edge && [edge.a, edge.b].every(p => p[0] === 50)).toBeFalsy();
  });
});
