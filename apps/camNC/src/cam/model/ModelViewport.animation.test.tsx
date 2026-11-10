import { useThree, type CanvasProps } from '@react-three/fiber';
import { cleanup, render, waitFor } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { BoxGeometry, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import type { BodyMesh, CamPartInfo } from '../camTypes';
import { ModelViewport, type ModelView } from './ModelViewport';

interface RenderedFrame {
  world: number[][];
  projected: number[][];
  camera: number[];
}
let frames: RenderedFrame[] = [];

// Instrument the real renderer from inside its real Canvas. State-only mocks miss a body whose local matrix
// changes while the matrixWorld used by WebGL remains stale; never force a matrix update in this probe.
vi.mock('@react-three/fiber', async importOriginal => {
  const actual = await importOriginal<typeof import('@react-three/fiber')>();
  return {
    ...actual,
    Canvas: ({ children, ...props }: CanvasProps) => (
      <actual.Canvas {...props}>
        <RenderedFrameProbe />
        {children}
      </actual.Canvas>
    ),
  };
});

function RenderedFrameProbe() {
  const renderer = useThree(state => state.gl);
  const rootScene = useThree(state => state.scene);
  useLayoutEffect(() => {
    const draw = renderer.render.bind(renderer);
    const spy = vi.spyOn(renderer, 'render').mockImplementation((scene, camera) => {
      draw(scene, camera);
      // ViewCube has a separate scene and camera; only observe the physical model's draw.
      if (scene !== rootScene) return;
      const bodies: Mesh[] = [];
      scene.traverse(object => {
        if (object instanceof Mesh && object.material instanceof MeshStandardMaterial) bodies.push(object);
      });
      if (bodies.length !== 2) return;
      const world = bodies.map(body =>
        new Vector3().fromBufferAttribute(body.geometry.getAttribute('position'), 0).applyMatrix4(body.matrixWorld)
      );
      frames.push({
        world: world.map(point => point.toArray()),
        projected: world.map(point => point.clone().project(camera).toArray()),
        camera: [...camera.matrixWorld.elements, ...camera.projectionMatrix.elements],
      });
    });
    return () => {
      spy.mockRestore();
    };
  }, [renderer, rootScene]);
  return null;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  frames = [];
});

function fixture() {
  // Large enough for both camera fits to exceed the studio's minimum zoom extent.
  const meshes: BodyMesh[] = [200, 400].map((x, index) => {
    const geometry = new BoxGeometry(200, 300, 100).translate(x, 150, 50);
    const mesh: BodyMesh = {
      name: `Part ${index}`,
      partId: `part-${index}`,
      positions: new Float32Array(geometry.getAttribute('position').array),
      indices: new Uint32Array(geometry.index!.array),
      flat: new Matrix4().toArray(),
    };
    geometry.dispose();
    return mesh;
  });
  const parts: CamPartInfo[] = meshes.map(mesh => ({
    id: mesh.partId,
    name: mesh.name,
    names: [mesh.name],
    thickness: 100,
    size: [200, 300, 100],
    summary: {
      chips: [],
      needsFlip: false,
      bottomDepths: [],
      notFlat: false,
      prismaticRatio: 1,
      slopedShare: 0,
      slopedArea: 0,
      smallestInsideRadius: null,
    },
    shape: { outlines: [], holes: [], pockets: [] },
  }));
  return { meshes, parts };
}

const difference = (actual: number[], expected: number[]) => Math.max(...actual.map((value, i) => Math.abs(value - expected[i]!)));
const sameWorld = (frame: RenderedFrame, expected: number[][]) => frame.world.every((point, i) => difference(point, expected[i]!) < 1e-8);
async function renderedFrame(matches: (frame: RenderedFrame) => boolean) {
  let found: RenderedFrame | undefined;
  await waitFor(
    () => {
      found = [...frames].reverse().find(matches);
      expect(found).toBeDefined();
    },
    { timeout: 20_000 }
  );
  return found!;
}

it.each(['studio', 'imported'] as const)(
  'renders intermediate exploded body positions with a stable %s camera',
  async mode => {
    const model = fixture();
    const view = (layout: ModelView, progress: number) => (
      <div style={{ width: 600, height: 400 }}>
        <ModelViewport
          {...model}
          view={layout}
          explosionProgress={progress}
          palette={mode === 'studio' ? 'studio' : undefined}
          selectedId={null}
          milled={() => true}
          onSelect={() => {}}
        />
      </div>
    );
    const host = render(view('assembled', 0));
    const assembled = await renderedFrame(frame => Math.hypot(...frame.camera.slice(12, 15)) > 10);
    // Calibrate the independently rendered endpoint, then test the assembled→exploded progression against it.
    frames = [];
    host.rerender(view('exploded', 1));
    const endpoint = await renderedFrame(
      frame =>
        difference(frame.camera, assembled.camera) > 1e-4 &&
        frame.world.every((point, i) => new Vector3().fromArray(point).distanceTo(new Vector3().fromArray(assembled.world[i]!)) > 10)
    );
    frames = [];
    host.rerender(view('assembled', 0));
    await renderedFrame(frame => sameWorld(frame, assembled.world) && difference(frame.camera, assembled.camera) < 1e-8);
    frames = [];
    host.rerender(view('exploded', 0));
    // A nested Canvas can still draw queued old props. Wait for the new camera fit as well as the exact body positions.
    const start = await renderedFrame(frame => sameWorld(frame, assembled.world) && difference(frame.camera, endpoint.camera) < 1e-8);
    expect(start.world).toEqual(assembled.world);
    const positions: RenderedFrame[] = [start];
    for (const progress of [0.25, 0.5, 1]) {
      frames = [];
      host.rerender(view('exploded', progress));
      const expected = start.world.map((point, i) =>
        new Vector3().fromArray(point).lerp(new Vector3().fromArray(endpoint.world[i]!), progress).toArray()
      );
      // Read the actual draw for this progress, rather than any pending frame from before the React commit.
      positions.push(await renderedFrame(frame => sameWorld(frame, expected)));
    }
    const end = positions[3]!;
    for (let body = 0; body < 2; body++) {
      const from = new Vector3().fromArray(start.world[body]!);
      const to = new Vector3().fromArray(end.world[body]!);
      expect(to.distanceTo(from)).toBeGreaterThan(10);
      for (const [index, progress] of [
        [1, 0.25],
        [2, 0.5],
      ] as const) {
        const intermediate = positions[index]!;
        expect(new Vector3().fromArray(intermediate.world[body]!).distanceTo(from.clone().lerp(to, progress))).toBeLessThan(1e-8);
        expect(
          new Vector3().fromArray(intermediate.projected[body]!).distanceTo(new Vector3().fromArray(start.projected[body]!))
        ).toBeGreaterThan(0.01);
        expect(difference(intermediate.camera, start.camera)).toBeLessThan(1e-8);
      }
    }
    expect(difference(end.camera, start.camera)).toBeLessThan(1e-8);
  },
  90_000
);
