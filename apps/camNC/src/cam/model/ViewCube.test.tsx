import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Mesh, Vector3, type Object3D } from 'three';
import { cubeViewRequest, ViewCube } from './ViewCube';
import { turnViewCubeBottomLabel } from './viewCubeBottomLabel';

vi.mock('./viewCubeBottomLabel', async original => {
  const { turnViewCubeBottomLabel } = await original<typeof import('./viewCubeBottomLabel')>();
  return { turnViewCubeBottomLabel: vi.fn(turnViewCubeBottomLabel) };
});

afterEach(cleanup);

it.each([
  [[1, 0, 0], 'right'],
  [[-1, 0, 0], 'left'],
  [[0, 1, 0], 'top'],
  [[0, -1, 0], 'bottom'],
  [[0, 0, 1], 'front'],
  [[0, 0, -1], 'back'],
] as const)('maps cube face %s to %s in the model frame', (normal, name) => {
  expect(cubeViewRequest([...normal])).toEqual({ name });
});

it.each([
  [
    [0.38, 0, 0.38],
    [1, -1, 0],
  ],
  [
    [-0.38, 0.38, 0.38],
    [-1, -1, 1],
  ],
] as const)('maps an edge or corner %s to a camera offset', (position, direction) => {
  expect(cubeViewRequest([...position])).toEqual({ name: 'iso', direction });
});

it('requests Top without moving the camera or missing, and leaves scene clicks outside the cube alone', async () => {
  const request = vi.fn(),
    select = vi.fn(),
    missed = vi.fn();
  let frames = 0;
  let cameraPosition: Vector3 | undefined;
  function Probe() {
    const camera = useThree(state => state.camera);
    useFrame(() => {
      frames++;
      cameraPosition = camera.position.clone();
    });
    return null;
  }
  const view = render(
    <div style={{ width: 400, height: 300 }}>
      <Canvas camera={{ position: [0, 0, 5], fov: 30 }} onPointerMissed={missed}>
        <mesh onClick={select}>
          <boxGeometry />
          <meshBasicMaterial />
        </mesh>
        <mesh position={[1.25, 0.8, 0]} onClick={select}>
          <boxGeometry args={[0.8, 0.8, 0.1]} />
          <meshBasicMaterial />
        </mesh>
        <ViewCube onViewRequest={request} />
        <Probe />
      </Canvas>
    </div>
  );
  // Shared browser runs can delay the first frames; keep waiting for rendering, rather than clicking an unready scene.
  await waitFor(() => expect(frames).toBeGreaterThan(2), { timeout: 10000 });
  const canvas = view.container.querySelector('canvas')!;
  const bounds = canvas.getBoundingClientRect();
  const click = (x: number, y: number) => {
    const at = { clientX: bounds.left + x, clientY: bounds.top + y, button: 0, pointerId: 1 };
    fireEvent.pointerDown(canvas, at);
    fireEvent.pointerUp(canvas, at);
    fireEvent.click(canvas, at);
  };
  // The cube sits 64 px in from the right and 112 px down, clear of the view's top-right buttons.
  click(336, 112);
  await waitFor(() => expect(request).toHaveBeenCalledWith({ name: 'top' }));
  expect(select).not.toHaveBeenCalled();
  expect(missed).not.toHaveBeenCalled();
  expect(cameraPosition!.toArray()).toEqual([0, 0, 5]);
  click(300, 30);
  expect(select).toHaveBeenCalledTimes(1);
  click(200, 150);
  expect(select).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenCalledTimes(1);
  expect(missed).not.toHaveBeenCalled();
  click(10, 290);
  expect(missed).toHaveBeenCalledTimes(1);
});

it('turns the BOTTOM label of the cube it shows (#698)', async () => {
  let frames = 0;
  function Probe() {
    useFrame(() => frames++);
    return null;
  }
  render(
    <div style={{ width: 400, height: 300 }}>
      <Canvas>
        <ViewCube onViewRequest={() => {}} />
        <Probe />
      </Canvas>
    </div>
  );
  await waitFor(() => expect(frames).toBeGreaterThan(2), { timeout: 10000 });
  const root = vi.mocked(turnViewCubeBottomLabel).mock.lastCall![0] as Object3D;
  const turned: Mesh[] = [];
  root.traverse(object => {
    if (object instanceof Mesh && object.geometry.userData.bottomLabelTurned) turned.push(object);
  });
  expect(turned).toHaveLength(1);
  expect(turned[0]!.material).toHaveLength(6);
});
