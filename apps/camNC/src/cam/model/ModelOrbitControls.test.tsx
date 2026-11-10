import { Canvas, useThree } from '@react-three/fiber';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import * as THREE from 'three';
import type { OrbitControls } from 'three-stdlib';
import { FitCamera, type ViewRequest } from './ModelViewport';
import { ModelOrbitControls } from './ModelOrbitControls';
import { kOrbitSurface } from './orbitPicking';

let camera: THREE.Camera;
let controls: OrbitControls;
afterEach(() => {
  cleanup();
  controls = null!;
  camera = null!;
});

function Probe() {
  camera = useThree(s => s.camera);
  controls = useThree(s => s.controls) as OrbitControls;
  return null;
}

const box = new THREE.Box3(new THREE.Vector3(-100, -60, -20), new THREE.Vector3(100, 60, 20));
function View({
  orthographic = true,
  enabled = true,
  request,
  bounds = box,
}: {
  orthographic?: boolean;
  enabled?: boolean;
  request?: ViewRequest;
  bounds?: THREE.Box3;
}) {
  return (
    <div style={{ width: 600, height: 400 }}>
      <Canvas orthographic={orthographic} camera={{ position: [0, 0, 1000], fov: 40 }}>
        <FitCamera box={box} viewRequest={request ?? { name: 'top', seq: 0 }} />
        <mesh userData={kOrbitSurface}>
          <boxGeometry args={[200, 120, 40]} />
          <meshBasicMaterial />
        </mesh>
        <ModelOrbitControls box={bounds} enabled={enabled} />
        <Probe />
      </Canvas>
    </div>
  );
}

async function ready(orthographic = true) {
  render(<View orthographic={orthographic} />);
  // Canvas and controls initialize asynchronously; cold WebGL contexts can take more than the default second.
  await waitFor(() => expect(controls?.target.toArray()).toEqual([0, 0, 0]), { timeout: 20000 });
  await waitFor(() => expect(camera.getWorldDirection(new THREE.Vector3()).z).toBeCloseTo(-1));
}

function projected(point: THREE.Vector3) {
  camera.updateMatrixWorld();
  return point.clone().project(camera);
}

function pointer(type: string, x: number, y: number, button = 2) {
  controls.domElement!.dispatchEvent(
    new PointerEvent(type, {
      pointerId: 1,
      pointerType: 'mouse',
      button,
      buttons: type === 'pointerup' ? 0 : button === 2 ? 2 : 4,
      clientX: x,
      clientY: y,
      bubbles: true,
    })
  );
}

function screen(point: THREE.Vector3) {
  const p = projected(point);
  const rect = controls.domElement!.getBoundingClientRect();
  return { x: rect.left + ((p.x + 1) * rect.width) / 2, y: rect.top + ((1 - p.y) * rect.height) / 2 };
}

function drag(from: { x: number; y: number }, button = 2) {
  pointer('pointerdown', from.x, from.y, button);
  pointer('pointermove', from.x + 40, from.y + 25, button);
  pointer('pointermove', from.x + 80, from.y + 45, button);
  pointer('pointerup', from.x + 80, from.y + 45, button);
}

async function finishMotion() {
  // Drain the actual control's inertia deterministically rather than waiting a fixed time.
  for (let i = 0; i < 100; i++) controls.update();
  await new Promise(resolve => requestAnimationFrame(resolve));
}

it.each([true, false])('keeps an off-center face hit fixed through right-drag and damping (orthographic=%s)', async orthographic => {
  await ready(orthographic);
  const pivot = new THREE.Vector3(65, 30, 20);
  const before = projected(pivot);
  const orientation = camera.quaternion.clone();
  const from = screen(pivot);
  pointer('pointerdown', from.x, from.y);
  expect(projected(pivot).distanceTo(before)).toBeLessThan(1e-8);
  pointer('pointermove', from.x + 50, from.y + 30);
  pointer('pointerup', from.x + 50, from.y + 30);
  await finishMotion();
  expect(camera.quaternion.angleTo(orientation)).toBeGreaterThan(0.1);
  expect(projected(pivot).distanceTo(before)).toBeLessThan(1e-6);
});

it('uses the current model center for a background drag after panning, without recentering the picture', async () => {
  await ready();
  drag(screen(new THREE.Vector3()), 1);
  await finishMotion();
  expect(controls.target.length()).toBeGreaterThan(1);
  const center = new THREE.Vector3();
  const before = projected(center);
  const rect = controls.domElement!.getBoundingClientRect();
  const from = { x: rect.left + 10, y: rect.top + 10 };
  drag(from);
  await finishMotion();
  expect(projected(center).distanceTo(before)).toBeLessThan(1e-6);
});

it('allows a named view to replace an orbit that is still damping', async () => {
  const view = render(<View />);
  await waitFor(() => expect(controls?.target.toArray()).toEqual([0, 0, 0]), { timeout: 20000 });
  drag(screen(new THREE.Vector3(65, 30, 20)));
  view.rerender(<View request={{ name: 'front', seq: 1 }} />);
  await waitFor(() => expect(camera.getWorldDirection(new THREE.Vector3()).y).toBeGreaterThan(0.99));
  await finishMotion();
  expect(controls.target.length()).toBeLessThan(1e-8);
  expect(camera.getWorldDirection(new THREE.Vector3()).distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-8);
});

it('leaves depth dragging alone while the camera controls are disabled', async () => {
  render(<View enabled={false} />);
  await waitFor(() => expect(controls?.target.toArray()).toEqual([0, 0, 0]), { timeout: 20000 });
  controls.update();
  const position = camera.position.clone();
  const orientation = camera.quaternion.clone();
  drag(screen(new THREE.Vector3(65, 30, 20)));
  await finishMotion();
  expect(camera.position.distanceTo(position)).toBeLessThan(1e-8);
  expect(camera.quaternion.angleTo(orientation)).toBeLessThan(1e-7);
});

it('keeps the active hit when a hover rerender replaces the bounds object', async () => {
  const view = render(<View />);
  await waitFor(() => expect(controls?.target.toArray()).toEqual([0, 0, 0]), { timeout: 20000 });
  const pivot = new THREE.Vector3(65, 30, 20);
  const before = projected(pivot);
  const from = screen(pivot);
  pointer('pointerdown', from.x, from.y);
  pointer('pointermove', from.x + 20, from.y + 10);
  view.rerender(<View bounds={box.clone()} />);
  await new Promise(resolve => requestAnimationFrame(resolve));
  pointer('pointermove', from.x + 50, from.y + 30);
  pointer('pointerup', from.x + 50, from.y + 30);
  await finishMotion();
  expect(projected(pivot).distanceTo(before)).toBeLessThan(1e-6);
});

it('anchors a new rotation immediately after a pan without carrying over the pan inertia', async () => {
  await ready();
  drag(screen(new THREE.Vector3()), 1);
  const pivot = new THREE.Vector3(65, 30, 20);
  const before = projected(pivot);
  drag(screen(pivot));
  await finishMotion();
  expect(projected(pivot).distanceTo(before)).toBeLessThan(1e-6);
});

it('chooses a fresh point for the next drag', async () => {
  await ready();
  drag(screen(new THREE.Vector3(65, 30, 20)));
  await finishMotion();
  const pivot = new THREE.Vector3();
  const before = projected(pivot);
  const rect = controls.domElement!.getBoundingClientRect();
  drag({ x: rect.left + 10, y: rect.top + 10 });
  await finishMotion();
  expect(projected(pivot).distanceTo(before)).toBeLessThan(1e-6);
});
