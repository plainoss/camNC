import { OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { cleanup, render, waitFor } from '@testing-library/react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { afterEach, expect, it } from 'vitest';
import { FitCamera, type ViewRequest } from './ModelViewport';

let seen: THREE.Camera | null = null;
let controls: OrbitControlsImpl | null = null;
afterEach(() => {
  cleanup();
  seen = null;
  controls = null;
});
function Probe() {
  seen = useThree(s => s.camera);
  controls = useThree(s => s.controls) as OrbitControlsImpl | null;
  return null;
}

const box = (size: number) => new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(size, size, size));

function View({ size, fitKey, viewRequest }: { size: number; fitKey: string; viewRequest?: ViewRequest }) {
  return (
    <div style={{ width: 400, height: 300 }}>
      <Canvas camera={{ fov: 30 }}>
        <FitCamera box={box(size)} fitKey={fitKey} viewRequest={viewRequest} />
        <OrbitControls makeDefault />
        <Probe />
      </Canvas>
    </div>
  );
}

it('leaves the camera where it is when what it shows changes, and fits again only for a new view', async () => {
  const view = render(<View size={100} fitKey="assembled" />);
  await waitFor(() => expect(controls?.target.toArray()).toEqual([50, 50, 50]));
  const fitted = seen!.position.clone();
  // A part hidden or edited: the box changes, the camera doesn't.
  view.rerender(<View size={400} fitKey="assembled" />);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(seen!.position.distanceTo(fitted)).toBeLessThan(1e-10);
  // Another view, such as exploded, is fitted again.
  view.rerender(<View size={400} fitKey="exploded" />);
  await waitFor(() => expect(seen!.position.distanceTo(fitted)).toBeGreaterThan(1));
});

it.each([
  ['front', [0, 1, 0], [0, 0, 1]],
  ['back', [0, -1, 0], [0, 0, 1]],
  ['left', [1, 0, 0], [0, 0, 1]],
  ['right', [-1, 0, 0], [0, 0, 1]],
  ['top', [0, 0, -1], [0, 1, 0]],
  ['bottom', [0, 0, 1], [0, 1, 0]],
  ['iso', new THREE.Vector3(-0.2, 0.75, -1).normalize().toArray(), [0, 0, 1]],
] as const)('refits from %s on a new sequence and orbits around the model centre', async (name, direction, up) => {
  const view = render(<View size={100} fitKey="assembled" viewRequest={{ name: 'iso', seq: 1 }} />);
  await waitFor(() => expect(controls?.target.toArray()).toEqual([50, 50, 50]));
  view.rerender(<View size={400} fitKey="assembled" viewRequest={{ name, seq: 2 }} />);
  await waitFor(() => expect(controls?.target.toArray()).toEqual([200, 200, 200]));
  expect(seen!.getWorldDirection(new THREE.Vector3()).distanceTo(new THREE.Vector3(...direction))).toBeLessThan(1e-10);
  expect(seen!.up.toArray()).toEqual(up);
  expect(
    seen!.position
      .clone()
      .sub(controls!.target)
      .normalize()
      .dot(new THREE.Vector3(...direction))
  ).toBeCloseTo(-1);
  // The whole box is inside the camera's frame.
  seen!.updateMatrixWorld();
  for (const x of [0, 400])
    for (const y of [0, 400])
      for (const z of [0, 400]) {
        const projected = new THREE.Vector3(x, y, z).project(seen!);
        expect(Math.max(Math.abs(projected.x), Math.abs(projected.y), Math.abs(projected.z))).toBeLessThan(1);
      }
});

it('does not move for the same sequence, even with a different request object, direction or box', async () => {
  const view = render(<View size={100} fitKey="assembled" viewRequest={{ name: 'top', seq: 1 }} />);
  await waitFor(() => expect(controls?.target.toArray()).toEqual([50, 50, 50]));
  seen!.position.add(new THREE.Vector3(30, 40, 50));
  controls!.update();
  const position = seen!.position.clone();
  const rotation = seen!.quaternion.clone();
  view.rerender(<View size={400} fitKey="assembled" viewRequest={{ name: 'front', seq: 1 }} />);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(seen!.position.distanceTo(position)).toBeLessThan(1e-10);
  expect(seen!.quaternion.angleTo(rotation)).toBeCloseTo(0);
});

it('fits the whole model while keeping the current viewing direction and up vector', async () => {
  const view = render(<View size={100} fitKey="assembled" viewRequest={{ name: 'top', seq: 1 }} />);
  await waitFor(() => expect(controls?.target.toArray()).toEqual([50, 50, 50]));
  seen!.position.set(150, -250, 450);
  controls!.target.set(10, 20, 30);
  controls!.update();
  const direction = seen!.getWorldDirection(new THREE.Vector3());
  const up = seen!.up.clone();
  view.rerender(<View size={400} fitKey="assembled" viewRequest={{ name: 'fit', seq: 2 }} />);
  await waitFor(() => expect(controls?.target.toArray()).toEqual([200, 200, 200]));
  expect(seen!.getWorldDirection(new THREE.Vector3()).distanceTo(direction)).toBeLessThan(1e-10);
  expect(seen!.up.toArray()).toEqual(up.toArray());
});

it('drops an orbit still easing out when a view is asked for', async () => {
  const view = render(<View size={100} fitKey="assembled" viewRequest={{ name: 'iso', seq: 1 }} />);
  await waitFor(() => expect(controls?.target.toArray()).toEqual([50, 50, 50]));
  // A quick drag leaves rotation for damping to apply over the next frames.
  const element = controls!.domElement!;
  const at = (type: string, x: number) =>
    element.dispatchEvent(new PointerEvent(type, { pointerId: 1, button: 0, buttons: 1, clientX: x, clientY: 150, bubbles: true }));
  at('pointerdown', 100);
  at('pointermove', 180);
  at('pointermove', 260);
  at('pointerup', 260);
  view.rerender(<View size={100} fitKey="assembled" viewRequest={{ name: 'top', seq: 2 }} />);
  await waitFor(() => expect(seen!.getWorldDirection(new THREE.Vector3()).z).toBeLessThan(-0.99));
  for (let frame = 0; frame < 20; frame++) await new Promise(resolve => requestAnimationFrame(resolve));
  expect(seen!.getWorldDirection(new THREE.Vector3()).distanceTo(new THREE.Vector3(0, 0, -1))).toBeLessThan(1e-6);
});
