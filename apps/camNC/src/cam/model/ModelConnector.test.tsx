import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { Group, Matrix4, Mesh, OrthographicCamera, PerspectiveCamera, Raycaster, Vector2, Vector3, type Scene } from 'three';
import { ModelConnector, type ViewConnector } from './ModelConnector';
import { settledCanvas } from '@/lib/settledCanvas';
import { settled } from '@/test/settled';

let scene: Scene | null = null;
let camera: OrthographicCamera | PerspectiveCamera | null = null;
let frames = 0;
let invalidate: (() => void) | null = null;
function Probe() {
  scene = useThree(state => state.scene);
  camera = useThree(state => state.camera) as OrthographicCamera | PerspectiveCamera;
  invalidate = useThree(state => state.invalidate);
  useFrame(() => frames++);
  return null;
}
afterEach(() => {
  cleanup();
  scene = null;
  camera = null;
  frames = 0;
  invalidate = null;
});

// Cold WebGL setup shares the GPU with other browser tests; settle on a drawn frame before inspecting connector geometry.
const firstFrame = async () => {
  await settled({ timeout: 20_000 });
  expect(frames).toBeGreaterThan(0);
};

const connector: ViewConnector = { point: [0, 0, 5], normal: [0, 0, 1], label: 'Source mate connector' };
function View({
  value = connector,
  model = new Matrix4(),
  orthographic = true,
}: {
  value?: ViewConnector;
  model?: Matrix4;
  orthographic?: boolean;
}) {
  return (
    <div style={{ width: 400, height: 300 }}>
      <Canvas {...settledCanvas} orthographic={orthographic} camera={{ position: [0, 0, 200], fov: 30, near: 0.1, far: 1000 }}>
        <mesh name="source solid">
          <planeGeometry args={[100, 100]} />
          <meshBasicMaterial />
        </mesh>
        <ModelConnector connector={value} model={model} />
        <Probe />
      </Canvas>
    </div>
  );
}

it('places a visible connector frame at its model point with Z along the picked normal', async () => {
  const model = new Matrix4().makeRotationX(-Math.PI / 2).setPosition(7, 11, 13);
  render(<View model={model} value={{ point: [10, 20, 30], normal: [0, 1, 0], label: 'Destination mate connector' }} />);
  await firstFrame();
  const frame = scene!.getObjectByName('Destination mate connector')!;
  scene!.updateMatrixWorld(true);
  const origin = frame.getWorldPosition(new Vector3());
  expect(origin.distanceTo(new Vector3(17, 41, -7))).toBeLessThan(1e-8);
  const z = new Vector3(0, 0, 1).transformDirection(frame.matrixWorld);
  expect(z.distanceTo(new Vector3(0, 0, -1))).toBeLessThan(1e-8);
  const marker = screen.getByLabelText('Destination mate connector');
  expect(marker.getBoundingClientRect().width).toBeGreaterThan(0);
  expect(getComputedStyle(marker).pointerEvents).toBe('none');
}, 25_000);

it.each([true, false])(
  'keeps connector axes at a constant screen size through camera zoom (orthographic=%s)',
  async orthographic => {
    render(<View orthographic={orthographic} />);
    await firstFrame();
    const frame = scene!.getObjectByName(connector.label)!;
    const axes = frame.children.find(child => child instanceof Group)!;
    const pixels = () => {
      scene!.updateMatrixWorld(true);
      const origin = axes.localToWorld(new Vector3()).project(camera!);
      const end = axes.localToWorld(new Vector3(1, 0, 0)).project(camera!);
      return ((end.x - origin.x) * 400) / 2;
    };
    expect(pixels()).toBeCloseTo(28, 5);
    const scale = axes.scale.x;
    camera!.zoom = 2;
    camera!.updateProjectionMatrix();
    invalidate!();
    await settled({ timeout: 20_000 });
    expect(axes.scale.x).toBeCloseTo(scale / 2, 8);
    expect(pixels()).toBeCloseTo(28, 5);
  },
  25_000
);

it('lets rays through its marker and axis overlays to the source solid', async () => {
  render(<View />);
  await firstFrame();
  scene!.updateMatrixWorld(true);
  camera!.updateMatrixWorld();
  const ray = new Raycaster();
  ray.setFromCamera(new Vector2(0, 0), camera!);
  const hits = ray.intersectObjects(scene!.children, true);
  expect(hits.length).toBeGreaterThan(0);
  expect(hits.every(hit => hit.object instanceof Mesh && hit.object.name === 'source solid' && hit.face != null)).toBe(true);
  expect(hits[0]!.point.toArray()).toEqual([0, 0, 0]);
}, 25_000);
