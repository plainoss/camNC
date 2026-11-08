import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { drawingMatrix, edgeOn, normalTurn, straightOn, turnAxes, turnedBy } from './sketchOrbit';

/** Where a point of the plane lands on screen, from the drawing's middle, y down, through a camera turned as the view is. */
function seen(turn: ReturnType<typeof turnedBy>, [x, y]: [number, number]) {
  const { back, up } = turnAxes(turn);
  const camera = new THREE.OrthographicCamera(-50, 50, 50, -50, 1, 40000);
  camera.position.set(...back).multiplyScalar(20000);
  camera.up.set(...up);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const p = new THREE.Vector3(x, y, 0).project(camera);
  return [p.x * 50, -p.y * 50];
}

describe('turning an open sketch’s view', () => {
  it('lays the drawing on screen where the turned camera sees its plane', () => {
    for (const [dx, dy] of [
      [100, 0],
      [0, 100],
      [80, 60],
      [-150, 40],
    ] as const) {
      const turn = turnedBy(straightOn, dx, dy);
      const [a, b, c, d] = drawingMatrix(turn);
      // The plane point (10, 20) is the drawing point (10, -20), y down.
      const [x, y] = seen(turn, [10, 20]);
      expect(a * 10 + c * -20).toBeCloseTo(x!, 6);
      expect(b * 10 + d * -20).toBeCloseTo(y!, 6);
    }
  });

  it('turns the plane’s far side toward a sideways drag, and leaves it alone without one', () => {
    expect(turnedBy(straightOn, 0, 0)).toBe(straightOn);
    // Dragged right, the right of the drawing goes away from the viewer and shows narrower.
    expect(turnAxes(turnedBy(straightOn, 100, 0)).back[0]).toBeLessThan(0);
    expect(drawingMatrix(turnedBy(straightOn, 100, 0))[0]).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('looks straight at the plane on n, and at its other side on n again', () => {
    const turned = turnedBy(straightOn, 60, 30);
    expect(normalTurn(turned)).toEqual(straightOn);
    expect(drawingMatrix(normalTurn(straightOn)).map(v => Math.round(v) + 0)).toEqual([-1, 0, 0, 1]);
    expect(normalTurn(normalTurn(straightOn))).toEqual(straightOn);
  });

  it('can’t be drawn on seen edge-on', () => {
    expect(edgeOn(straightOn)).toBe(false);
    expect(edgeOn(turnedBy(straightOn, 200, 0))).toBe(true);
  });
});
