import { Canvas, useThree } from '@react-three/fiber';
import { cleanup, render, waitFor } from '@testing-library/react';
import { createPlateDocument, parseCadDocument } from '@wbcnc/cad';
import { memo } from 'react';
import { BufferGeometry, EdgesGeometry, Mesh, OrthographicCamera, Raycaster, Vector2, type Scene } from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import designText from '../../../../../packages/cad-script/fixtures/designs/finger-joint-face-sketch.json?raw';
import { assemblyModel } from '../../cad/assemblyModel';
import type { BodyMesh } from '../camTypes';
import { ModelBody } from './ModelBody';
import { modelGeometry } from './modelGeometry';

// Production's React Compiler reuses JSX with unchanged props. Keep that behavior here:
// changing a parent mesh alone must not be needed to rerender its edge overlay.
vi.mock('@react-three/drei', async importOriginal => {
  const actual = await importOriginal<typeof import('@react-three/drei')>();
  return { ...actual, Edges: memo(actual.Edges) };
});

let scene: Scene | null = null;
function Probe() {
  scene = useThree(state => state.scene);
  return null;
}
afterEach(() => {
  cleanup();
  scene = null;
});

function View({ mesh }: { mesh: BodyMesh }) {
  return (
    <div style={{ width: 400, height: 300 }}>
      <Canvas>
        <ModelBody mesh={mesh} matrix={null} color="#b8c0c9" opacity={1} edges onSelect={() => {}} onHover={() => {}} />
        <Probe />
      </Canvas>
    </div>
  );
}

function endpoints(geometry: BufferGeometry, names: string[]) {
  return names
    .flatMap(name => {
      const points = geometry.getAttribute(name);
      return Array.from({ length: points.count }, (_, i) =>
        [points.getX(i), points.getY(i), points.getZ(i)].map(value => value.toFixed(4)).join(',')
      );
    })
    .sort();
}

it('lets a corner pick reach the solid face through its decorative edge overlay', async () => {
  const document = createPlateDocument({ width: 120, height: 80, thickness: 18 });
  document.parts[0]!.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const mesh = assemblyModel(document).meshes[0]!;
  render(<View mesh={mesh} />);
  await waitFor(() => expect(scene?.children.find(child => child instanceof Mesh)?.children.length).toBeGreaterThan(0));
  const body = scene!.children.find(child => child instanceof Mesh)!;
  const camera = new OrthographicCamera(-100, 100, 100, -100, 0.1, 500);
  camera.position.set(0, 0, 200);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  scene!.updateMatrixWorld(true);
  const ray = new Raycaster();
  ray.setFromCamera(new Vector2(0, 0), camera);
  const hits = ray.intersectObject(body, true);
  expect(hits.length).toBeGreaterThan(0);
  // A line hit has no face and would prevent selecting a mate connector at this corner.
  expect(hits.every(hit => hit.face != null)).toBe(true);
  expect(hits[0]!.point.toArray()).toEqual([0, 0, 18]);
});

it('updates the visible edges with the solid when a joint changes from five to three to eight fingers', async () => {
  const document = parseCadDocument(JSON.parse(designText));
  const meshes = [5, 3, 8].map(fingers => {
    document.partCuts![0]!.split = { fingers };
    return assemblyModel(document).meshes[0]!;
  });
  const view = render(<View mesh={meshes[0]!} />);
  for (const mesh of meshes) {
    view.rerender(<View mesh={mesh} />);
    const solid = modelGeometry(mesh);
    const expected = new EdgesGeometry(solid, 20);
    await waitFor(() => {
      const body = scene?.children.find(child => child instanceof Mesh) as Mesh | undefined;
      expect(body).toBeDefined();
      expect(endpoints(body!.geometry, ['position'])).toEqual(endpoints(solid, ['position']));
      const overlay = body!.children.find(child => 'geometry' in child) as Mesh | undefined;
      expect(overlay).toBeDefined();
      expect(endpoints(overlay!.geometry, ['instanceStart', 'instanceEnd'])).toEqual(endpoints(expected, ['position']));
    });
    expected.dispose();
    solid.dispose();
  }
});
