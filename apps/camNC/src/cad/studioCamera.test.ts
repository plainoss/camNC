import { expect, it } from 'vitest';
import { OrthographicCamera, Vector3 } from 'three';
import { cameraFromSketch, sketchFromCamera, type StudioCameraState } from './studioCamera';
import { drawingMatrix, turnedBy } from './sketchOrbit';

it('keeps projected points fixed when a panned, zoomed and orbited camera enters and leaves different sketch planes', () => {
  const camera: StudioCameraState = {
    center: [14, -22, 35],
    back: new Vector3(0.4, -1, 0.3).normalize().toArray(),
    up: [0, 0, 1],
    height: 190,
    key: 'assembled',
    seq: 4,
  };
  const before = new OrthographicCamera(-152, 152, 95, -95, 1, 40000);
  before.position.set(...camera.center).addScaledVector(new Vector3(...camera.back), 20000);
  before.up.set(...camera.up);
  before.lookAt(...camera.center);
  before.updateMatrixWorld();
  for (const frame of [
    { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], normal: [0, -1, 0] },
    { origin: [12, -25, 18], x: [0, 1, 0], y: [0, 0, 1], normal: [1, 0, 0] },
    { origin: [0, 0, 25], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] },
  ] as const) {
    const mutable = { origin: [...frame.origin], x: [...frame.x], y: [...frame.y], normal: [...frame.normal] } as {
      origin: [number, number, number];
      x: [number, number, number];
      y: [number, number, number];
      normal: [number, number, number];
    };
    const sketch = sketchFromCamera(camera, mutable, 1.6)!;
    const [a, b, c, d] = drawingMatrix(sketch.turn);
    for (const [x, y] of [
      [0, 0],
      [57, 78],
      [-20, 30],
    ]) {
      const world = new Vector3(...mutable.origin)
        .addScaledVector(new Vector3(...mutable.x), x!)
        .addScaledVector(new Vector3(...mutable.y), y!);
      const point = world.project(before);
      const dx = x! - sketch.view.x - sketch.view.w / 2;
      const dy = -y! - sketch.view.y - sketch.view.h / 2;
      expect((a * dx + c * dy + sketch.shift[0]) / (sketch.view.w / 2)).toBeCloseTo(point.x, 8);
      expect(-(b * dx + d * dy + sketch.shift[1]) / (sketch.view.h / 2)).toBeCloseTo(point.y, 8);
    }
    const after = cameraFromSketch(mutable, sketch.view, sketch.turn, camera, sketch.shift);
    expect(after.height).toBe(camera.height);
    expect(new Vector3(...after.back).distanceTo(new Vector3(...camera.back))).toBeLessThan(1e-10);
    expect(after).toMatchObject({ key: 'assembled', seq: 4 });
    // Changes made while drawing carry back, too.
    const turned = cameraFromSketch(mutable, { ...sketch.view, h: 95 }, turnedBy(sketch.turn, 45, 20), camera);
    expect(turned.height).toBe(95);
    expect(turned.back).not.toEqual(after.back);
  }
});

it('retains an edge-on plane and its screen offset instead of turning normal to it', () => {
  const state: StudioCameraState = { center: [14, -22, 35], back: [1, 0, 0], up: [0, 0, 1], height: 190 };
  const frame = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] } as const;
  const mutable = { origin: [...frame.origin], x: [...frame.x], y: [...frame.y], normal: [...frame.normal] } as {
    origin: [number, number, number];
    x: [number, number, number];
    y: [number, number, number];
    normal: [number, number, number];
  };
  const sketch = sketchFromCamera(state, mutable, 1.6);
  expect(sketch.shift[1]).toBeCloseTo(35);
  const after = cameraFromSketch(mutable, sketch.view, sketch.turn, state, sketch.shift);
  after.center.forEach((n, i) => expect(n).toBeCloseTo(state.center[i]!, 8));
  after.back.forEach((n, i) => expect(n).toBeCloseTo(state.back[i]!, 8));
});
