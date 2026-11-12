import { expect, it } from 'vitest';
import type { StudioCameraState } from './studioCamera';
import { partCameraFromAssembly } from './partAssemblyCamera';

it.each([false, true])('carries the visible moved and rotated copy camera into unreflected local axes, mirrored=%s', mirrored => {
  const camera: StudioCameraState = {
    center: [260, mirrored ? -50 : 50, 18],
    back: [0, mirrored ? -1 : 1, 0],
    up: [0, 0, 1],
    height: 100,
    key: 'assembled',
  };
  const bytes = JSON.stringify(camera);
  const result = partCameraFromAssembly(
    camera,
    {
      position: [300, 0, 0],
      rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
    },
    mirrored
  );
  // A quarter turn takes (local x, local y) to (-y, x); reflection happens before that turn.
  result.center.forEach((value, axis) => expect(value).toBeCloseTo([50, 40, 18][axis]!, 12));
  result.back.forEach((value, axis) => expect(value).toBeCloseTo([1, 0, 0][axis]!, 12));
  result.up.forEach((value, axis) => expect(value).toBeCloseTo([0, 0, 1][axis]!, 12));
  expect(result.height).toBe(100);
  expect(JSON.stringify(camera)).toBe(bytes);
});

it.each([false, true])('projects asymmetric top and underside landmarks in the declared unreflected editor axes, mirrored=%s', mirrored => {
  type Point = [number, number, number];
  const cross = (a: Point, b: Point): Point => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: Point, b: Point) => a.reduce((sum, value, axis) => sum + value * b[axis]!, 0);
  const project = (camera: StudioCameraState, point: Point) => {
    const right = cross(camera.up, camera.back),
      up = cross(camera.back, right);
    const delta = point.map((value, axis) => value - camera.center[axis]!) as Point;
    return [dot(delta, right), dot(delta, up)];
  };
  const placement = { position: [300, 0, 0] as Point, rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] as [number, number, number, number] };
  // Independent quarter-turn and reflection, without using the adapter's inverse transform.
  const world = ([x, y, z]: Point): Point => [300 - y, mirrored ? -x : x, z];
  for (const side of [1, -1]) {
    const z = side === 1 ? 18 : 0;
    const camera: StudioCameraState = { center: world([50, 30, z]), back: [0, 0, side], up: [0, 1, 0], height: 100 };
    const local = partCameraFromAssembly(camera, placement, mirrored);
    expect(local.back[2]).toBe(side);
    // Three noncollinear, asymmetric face locations expose a horizontal flip that a centroid alone cannot detect.
    for (const point of [
      [10, 7, z],
      [70, 13, z],
      [23, 52, z],
    ] as Point[]) {
      const actual = project(local, point),
        physical = project(camera, world(point));
      expect(actual[0]).toBeCloseTo((mirrored ? -1 : 1) * physical[0]!, 12);
      expect(actual[1]).toBeCloseTo(physical[1]!, 12);
    }
  }
});
