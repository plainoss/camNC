import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { measurementEntityAt, planarMeasurementFace } from './measurementPick';
import { nearestEdge, screenDistance } from './edgePick';
import type { MeasureTriangle, MeasureVec3 } from '@/cad/measureGeometry';

// An independently authored 100 × 60 × 40 box; its top's long edges have a triangulation vertex in the middle.
const positions = new Float32Array([
  0, 0, 0, 100, 0, 0, 100, 60, 0, 0, 60, 0, 0, 0, 40, 100, 0, 40, 100, 60, 40, 0, 60, 40, 50, 0, 40, 50, 60, 40,
]);
// biome-ignore format: each row is one independently authored triangle
const indices = new Uint32Array([
  0, 2, 1, 0, 3, 2,
  4, 8, 9, 4, 9, 7, 8, 5, 6, 8, 6, 9,
  0, 1, 5, 0, 5, 4,
  1, 2, 6, 1, 6, 5,
  2, 3, 7, 2, 7, 6,
  3, 0, 4, 3, 4, 7,
]);

function topProjection(x: number, y: number) {
  const camera = new THREE.OrthographicCamera(-50, 50, 30, -30, 1, 1000);
  camera.position.set(50, 30, 200);
  camera.lookAt(50, 30, 0);
  camera.updateMatrixWorld();
  const pointer = new THREE.Vector3(x, y, 40).project(camera);
  return screenDistance(camera, new THREE.Matrix4(), 1000, 600, pointer);
}

function area(triangles: MeasureTriangle[]) {
  return triangles.reduce((sum, triangle) => {
    const [a, b, c] = triangle.map(p => new THREE.Vector3(...p));
    return sum + b!.sub(a!).cross(c!.sub(a!)).length() / 2;
  }, 0);
}

describe('assembled geometry measurement picking', () => {
  it('selects actual top vertices, not an occluded bottom vertex at the same screen position', () => {
    expect(measurementEntityAt(positions, indices, 2, topProjection(0, 0))).toEqual({ kind: 'vertex', point: [0, 0, 40] });
  });

  it('joins tessellation splits into one straight edge instead of inventing a midpoint vertex', () => {
    const entity = measurementEntityAt(positions, indices, 2, topProjection(50, 0));
    expect(entity).toEqual({ kind: 'edge', a: [0, 0, 40], b: [100, 0, 40] });
  });

  it('treats a face center as a face, preserves its full finite area and gives it stable identity from every triangle', () => {
    const entity = measurementEntityAt(positions, indices, 2, topProjection(50, 30));
    expect(entity?.kind).toBe('face');
    if (entity?.kind !== 'face') throw new Error('Expected the top face');
    expect(entity.triangles).toHaveLength(4);
    expect(area(entity.triangles)).toBe(6000);
    for (const triangle of [3, 4, 5]) expect(planarMeasurementFace(positions, indices, triangle)).toEqual(entity);
  });

  it('keeps disjoint coplanar faces separate even when they meet only at a corner', () => {
    const p = new Float32Array([0, 0, 0, 20, 0, 0, 20, 20, 0, 0, 20, 0, 40, 20, 0, 40, 40, 0, 20, 40, 0]);
    const i = new Uint32Array([0, 1, 2, 0, 2, 3, 2, 4, 5, 2, 5, 6]);
    const first = planarMeasurementFace(p, i, 0)!,
      second = planarMeasurementFace(p, i, 2)!;
    expect(first.triangles).toHaveLength(2);
    expect(second.triangles).toHaveLength(2);
    expect(area(first.triangles)).toBe(400);
    expect(first).not.toEqual(second);
    expect(measurementEntityAt(p, i, 0, topProjection(20, 10))).toEqual({ kind: 'edge', a: [20, 0, 0], b: [20, 20, 0] });
    expect(measurementEntityAt(p, i, 0, topProjection(20, 20))).toEqual({ kind: 'vertex', point: [20, 20, 0] });
  });

  it('preserves an inner opening instead of selecting a filled face bounding rectangle', () => {
    const p = new Float32Array([0, 0, 0, 100, 0, 0, 100, 60, 0, 0, 60, 0, 40, 20, 0, 60, 20, 0, 60, 40, 0, 40, 40, 0]);
    const i = new Uint32Array([0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
    const face = planarMeasurementFace(p, i, 0)!;
    expect(face.triangles).toHaveLength(8);
    expect(area(face.triangles)).toBe(5600);
  });

  it('joins a coplanar T-junction without promoting its internal seam to an edge or vertex', () => {
    const p = new Float32Array([0, 0, 0, 50, 0, 0, 50, 60, 0, 0, 60, 0, 100, 0, 0, 100, 60, 0, 50, 30, 0]);
    const i = new Uint32Array([0, 1, 2, 0, 2, 3, 1, 4, 6, 4, 5, 6, 5, 2, 6]);
    const projection = topProjection(50, 30);
    const entity = measurementEntityAt(p, i, 0, projection);
    expect(entity?.kind).toBe('face');
    if (entity?.kind !== 'face') throw new Error('Expected the joined planar face');
    expect(entity.triangles).toHaveLength(5);
    expect(area(entity.triangles)).toBe(6000);
  });

  it('reports transformed copy geometry in assembly space rather than screen or flattened coordinates', () => {
    const matrix = new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(230, -70, 50);
    const p = positions.slice(),
      v = new THREE.Vector3();
    for (let j = 0; j < p.length; j += 3) v.fromArray(p, j).applyMatrix4(matrix).toArray(p, j);
    const corner: MeasureVec3 = [270, -70, 50];
    const camera = new THREE.OrthographicCamera(-100, 100, 100, -100, 1, 1000);
    camera.position.set(600, -100, 200);
    camera.lookAt(250, -40, 0);
    camera.updateMatrixWorld();
    const display = new THREE.Matrix4().makeTranslation(40, 0, 0);
    const pointer = new THREE.Vector3(...corner).applyMatrix4(display).project(camera);
    const screen = screenDistance(camera, display, 800, 800, pointer);
    expect(measurementEntityAt(p, indices, 2, screen)).toEqual({ kind: 'vertex', point: corner });
  });

  it('rejects invalid or degenerate picked mesh triangles', () => {
    expect(planarMeasurementFace(positions, indices, -1)).toBeNull();
    expect(planarMeasurementFace(positions, indices, 1000)).toBeNull();
    expect(planarMeasurementFace(new Float32Array([0, 0, 0]), new Uint32Array([0, 0, 0]), 0)).toBeNull();
  });

  it('invalidates cached edges when a mesh reuses its vertices with different topology', () => {
    const p = new Float32Array([0, 0, 0, 20, 0, 0, 20, 20, 0, 0, 20, 0]);
    const full = new Uint32Array([0, 1, 2, 0, 2, 3]),
      half = new Uint32Array([0, 1, 2]);
    expect(nearestEdge(p, full, [10, 10, 0], 1)).toBeNull();
    const diagonal = nearestEdge(p, half, [10, 10, 0], 1)!;
    expect([diagonal.a, diagonal.b].map(p => p.join(',')).sort()).toEqual(['0,0,0', '20,20,0']);
    expect(nearestEdge(p, full, [10, 10, 0], 1)).toBeNull();
  });
});
