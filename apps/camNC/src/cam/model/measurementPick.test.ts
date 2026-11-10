import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { measurementEntityAt, planarMeasurementFace } from './measurementPick';
import { nearestEdge, screenDistance } from './edgePick';
import { measureEntities, type MeasureTriangle, type MeasureVec3 } from '@/cad/measureGeometry';

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

/** Euler XYZ (0.3, 0.7, 0.4), followed by a rigid translation, before the renderer's Float32 storage. */
function placedPositions(points: MeasureVec3[], translation = 1000) {
  const [sx, sy, sz] = [0.3, 0.7, 0.4].map(Math.sin),
    [cx, cy, cz] = [0.3, 0.7, 0.4].map(Math.cos);
  return new Float32Array(
    points.flatMap(([x, y, z]) => {
      const zx = cz! * x - sz! * y,
        zy = sz! * x + cz! * y;
      const yx = cy! * zx + sy! * z,
        yz = -sy! * zx + cy! * z;
      return [translation + yx, translation + cx! * zy - sx! * yz, translation + sx! * zy + cx! * yz];
    })
  );
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

  it('keeps the full area and identity of a thin rotated face after Float32 placement', () => {
    const p = placedPositions([
      [0, 0, 0],
      [100, 0, 0],
      [100, 0.1, 0],
      [0, 0.1, 0],
    ]);
    const i = new Uint32Array([0, 1, 2, 0, 2, 3]);
    const first = planarMeasurementFace(p, i, 0)!;
    expect(area(first.triangles)).toBeCloseTo(10, 2);
    expect(first.triangles).toHaveLength(2);
    expect(measureEntities([first]).rows.find(row => row.id === 'area')?.value).toBeCloseTo(10, 2);
    expect(planarMeasurementFace(p, i, 1)).toBe(first);
    // A first click on the other triangle must give the same identity without benefiting from the first pick's cache.
    expect(planarMeasurementFace(p.slice(), i, 1)).toEqual(first);
    expect(measurementEntityAt(p, i, 1, { point: () => Infinity, segment: () => Infinity })).toBe(first);
  });

  it.each([
    { label: 'sharp', angle: Math.PI / 2 },
    { label: 'shallow', angle: 0.01 },
  ])('keeps a resolvable $label fold separate after the same thin Float32 placement', ({ angle }) => {
    // The shallow fold lifts the opposite vertex by about 0.001mm, above this placement's Float32 uncertainty.
    const p = placedPositions([
      [0, 0, 0],
      [100, 0, 0],
      [0, 0.1, 0],
      [0, -0.1 * Math.cos(angle), 0.1 * Math.sin(angle)],
    ]);
    const i = new Uint32Array([0, 1, 2, 1, 0, 3]);
    for (const seed of [0, 1]) {
      const face = planarMeasurementFace(p.slice(), i, seed)!;
      expect(face.triangles).toHaveLength(1);
      expect(area(face.triangles)).toBeCloseTo(5, 2);
    }
  });

  it('keeps a much shallower fold distinct when broad triangles resolve its normal accurately', () => {
    const angle = 0.0005;
    const p = placedPositions([
      [0, 0, 0],
      [100, 0, 0],
      [0, 100, 0],
      [0, -100 * Math.cos(angle), 100 * Math.sin(angle)],
    ]);
    const i = new Uint32Array([0, 1, 2, 1, 0, 3]);
    for (const seed of [0, 1]) expect(planarMeasurementFace(p.slice(), i, seed)!.triangles).toHaveLength(1);
  });

  it('retains a thin rotated opening and a stable identity from every triangle without a warm cache', () => {
    const p = placedPositions([
      [0, 0, 0],
      [100, 0, 0],
      [100, 0.1, 0],
      [0, 0.1, 0],
      [40, 0.03, 0],
      [60, 0.03, 0],
      [60, 0.07, 0],
      [40, 0.07, 0],
    ]);
    const i = new Uint32Array([0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
    const face = planarMeasurementFace(p, i, 0)!;
    expect(face.triangles).toHaveLength(8);
    expect(area(face.triangles)).toBeCloseTo(100 * 0.1 - 20 * 0.04, 2);
    for (let seed = 0; seed < 8; seed++) expect(planarMeasurementFace(p.slice(), i, seed)).toEqual(face);
  });

  it('partitions a gradually folded strip into disjoint faces independently of the first picked triangle', () => {
    const points: MeasureVec3[] = [];
    let y = 0,
      z = 0;
    for (let row = 0; row < 4; row++) {
      points.push([0, y, z], [100, y, z]);
      y += 0.1 * Math.cos(row * 0.0015);
      z += 0.1 * Math.sin(row * 0.0015);
    }
    const p = placedPositions(points),
      i = new Uint32Array([0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4, 4, 5, 7, 4, 7, 6]);
    const keys = Array.from({ length: 6 }, (_, triangle) =>
      [0, 1, 2]
        .flatMap(k => {
          const offset = i[triangle * 3 + k]! * 3;
          return Array.from(p.slice(offset, offset + 3));
        })
        .join(',')
    );
    const members = (face: NonNullable<ReturnType<typeof planarMeasurementFace>>) =>
      face.triangles.map(triangle => keys.indexOf(triangle.flat().join(',')));
    const fresh = Array.from({ length: 6 }, (_, seed) => members(planarMeasurementFace(p.slice(), i, seed)!));
    for (let seed = 0; seed < 6; seed++) {
      expect(fresh[seed]).toContain(seed);
      expect(fresh[seed]!.length).toBeLessThan(6); // Local compatibility must not drift into one face around the curve.
      for (let other = 0; other < 6; other++) {
        if (fresh[seed]!.some(index => fresh[other]!.includes(index))) expect(fresh[seed]).toEqual(fresh[other]);
      }
    }
    expect([...new Set(fresh.flat())].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    for (const order of [
      [0, 1, 2, 3, 4, 5],
      [5, 4, 3, 2, 1, 0],
      [2, 0, 5, 1, 4, 3],
    ]) {
      const buffer = p.slice(),
        picked: number[][] = [];
      for (const seed of order) picked[seed] = members(planarMeasurementFace(buffer, i, seed)!);
      expect(picked).toEqual(fresh);
    }
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
