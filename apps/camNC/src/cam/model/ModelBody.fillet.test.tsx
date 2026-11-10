import { Canvas, useThree } from '@react-three/fiber';
import { cleanup, render, waitFor } from '@testing-library/react';
import { createPlateDocument, filletLineCorners } from '@wbcnc/cad';
import { EdgesGeometry, type WebGLRenderer } from 'three';
import { afterEach, expect, it } from 'vitest';
import { assemblyModel } from '../../cad/assemblyModel';
import type { BodyMesh } from '../camTypes';
import { ModelBody } from './ModelBody';
import { modelGeometry } from './modelGeometry';

let renderer: WebGLRenderer | null = null;
function Probe() {
  renderer = useThree(state => state.gl);
  return null;
}
afterEach(() => {
  cleanup();
  renderer = null;
});
function View({ mesh }: { mesh: BodyMesh }) {
  return (
    <div style={{ width: 400, height: 300 }}>
      <Canvas orthographic camera={{ position: [50, 30, 200], zoom: 2 }}>
        <ModelBody mesh={mesh} matrix={null} color="#b8c0c9" opacity={1} edges onSelect={() => {}} onHover={() => {}} />
        <Probe />
      </Canvas>
    </div>
  );
}

it('draws every original curved outline segment after creating, suppressing and restoring another solid fillet', async () => {
  const document = createPlateDocument({ width: 100, height: 60, thickness: 24 });
  const part = document.parts[0]!;
  part.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const corner = (x: number, y: number) =>
    part.sketch.entities.find(entity => entity.type === 'point' && entity.x === x && entity.y === y)!.id;
  const rearRight = corner(100, 60);
  const rounded = filletLineCorners(part.sketch, { cornerPointIds: [corner(0, 0), corner(100, 0)], radius: 10 });
  if (!rounded.ok) throw new Error(rounded.message);
  part.sketch = rounded.sketch;
  const meshes = [assemblyModel(document).meshes[0]!];
  part.fillets = [{ id: 'solid-fillet', radius: 5, corners: [rearRight] }];
  meshes.push(assemblyModel(document).meshes[0]!);
  part.fillets[0]!.suppressed = true;
  meshes.push(assemblyModel(document).meshes[0]!);
  delete part.fillets[0]!.suppressed;
  meshes.push(assemblyModel(document).meshes[0]!);
  const view = render(<View mesh={meshes[0]!} />);
  let originalCurve: string[] | undefined;
  for (const mesh of meshes) {
    view.rerender(<View mesh={mesh} />);
    const solid = modelGeometry(mesh);
    const edges = new EdgesGeometry(solid, 20);
    const points = edges.getAttribute('position');
    // This original R10 corner is remote from the newly rounded rear-right corner.
    const curve: string[] = [];
    for (let i = 0; i < points.count; i += 2) {
      if ([i, i + 1].every(index => points.getX(index) <= 10 && points.getY(index) <= 10 && points.getZ(index) === 24))
        curve.push(
          [i, i + 1]
            .map(index => `${points.getX(index).toFixed(4)},${points.getY(index).toFixed(4)}`)
            .sort()
            .join(' ')
        );
    }
    expect(curve.length).toBeGreaterThan(5);
    if (!originalCurve) originalCurve = curve.sort();
    else expect(curve.sort()).toEqual(originalCurve);
    // Each wide-line segment is six GPU triangles. Checking uploaded endpoints alone misses a stale instanced draw cap.
    const triangles = solid.getAttribute('position').count / 3 + (points.count / 2) * 6;
    await waitFor(() => expect(renderer?.info.render.triangles).toBe(triangles));
    edges.dispose();
    solid.dispose();
  }
});
