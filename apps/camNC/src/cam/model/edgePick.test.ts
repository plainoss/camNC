import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { nearestEdge, nearestEdgeBy, screenDistance } from './edgePick';

// A 100 × 60 × 40 box, its top split into four triangles meeting in the middle of its long edges.
const positions = new Float32Array([
  0, 0, 0, 100, 0, 0, 100, 60, 0, 0, 60, 0, 0, 0, 40, 100, 0, 40, 100, 60, 40, 0, 60, 40, 50, 0, 40, 50, 60, 40,
]);
// prettier-ignore
const indices = [
  0,
  2,
  1,
  0,
  3,
  2, // bottom
  4,
  8,
  9,
  4,
  9,
  7,
  8,
  5,
  6,
  8,
  6,
  9, // top, in two halves
  0,
  1,
  5,
  0,
  5,
  4,
  1,
  2,
  6,
  1,
  6,
  5,
  2,
  3,
  7,
  2,
  7,
  6,
  3,
  0,
  4,
  3,
  4,
  7, // sides
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

describe('picking an edge on screen', () => {
  // Looking at the box's top almost edge-on, from far off along -y, so the top is squashed into a few pixels.
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 10_000);
  camera.position.set(50, -1000, 60);
  camera.lookAt(50, 30, 40);
  camera.updateMatrixWorld();
  const pointerAt = (p: [number, number, number]) => {
    const v = new THREE.Vector3(...p).project(camera);
    return { x: v.x, y: v.y };
  };

  it('measures in pixels, so an edge a few pixels away is picked however the face is turned', () => {
    // A point on the top 10 mm in from its far edge is only a pixel or so from it on screen.
    const screen = screenDistance(camera, new THREE.Matrix4(), 800, 800, pointerAt([50, 50, 40]));
    const edge = nearestEdgeBy(positions, indices, screen.segment, 8);
    expect(edge).not.toBeNull();
    expect(screen.segment([0, 60, 40], [100, 60, 40])).toBeLessThan(8);
  });

  it('gives the distance to a corner in pixels', () => {
    const screen = screenDistance(camera, new THREE.Matrix4(), 800, 800, pointerAt([0, 0, 40]));
    expect(screen.point([0, 0, 40])).toBeCloseTo(0, 6);
    expect(screen.point([100, 0, 40])).toBeGreaterThan(8);
  });
});
