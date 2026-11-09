import { Canvas, useThree } from '@react-three/fiber';
import { cleanup, render, waitFor } from '@testing-library/react';
import { parseCadDocument } from '@wbcnc/cad';
import { memo } from 'react';
import { BufferGeometry, EdgesGeometry, Mesh, type Scene } from 'three';
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
