import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { BodyMesh } from '@/cam/camTypes';
import { partEdgesOnPlane } from './partEdges';

/** A 100 × 50 × 20 board with its lower corner at the origin. */
function board(partId: string): BodyMesh {
  const box = new THREE.BoxGeometry(100, 50, 20).translate(50, 25, 10);
  const positions = box.getAttribute('position').array as Float32Array;
  return { name: partId, partId, positions, indices: new Uint32Array(box.getIndex()!.array), flat: [] };
}

const top = {
  origin: [0, 0, 0] as [number, number, number],
  x: [1, 0, 0] as [number, number, number],
  y: [0, 1, 0] as [number, number, number],
  normal: [0, 0, 1] as [number, number, number],
};

describe('the edges of the parts behind a sketch', () => {
  it('lays each edge onto the plane once, and says which lie in it', () => {
    const edges = partEdgesOnPlane([board('a')], top);
    // The board's outline from above: its four sides, the upright edges seen end-on left out.
    expect(edges).toHaveLength(4);
    expect(edges.every(edge => edge.onPlane)).toBe(true);
    expect(edges.map(edge => Math.hypot(edge.x2 - edge.x1, edge.y2 - edge.y1)).sort((a, b) => a - b)).toEqual([50, 50, 100, 100]);
  });

  it('marks edges seen through the plane as not in it', () => {
    const edges = partEdgesOnPlane([board('a')], { ...top, origin: [0, 0, -5] });
    expect(edges).toHaveLength(4);
    expect(edges.some(edge => edge.onPlane)).toBe(false);
  });
});
