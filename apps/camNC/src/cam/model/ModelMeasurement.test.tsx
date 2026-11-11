import { Canvas, useThree } from '@react-three/fiber';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { Mesh, Raycaster, Vector3, type Scene } from 'three';
import { ModelMeasurement } from './ModelMeasurement';
import type { MeasureEntity } from '@/cad/measureGeometry';
import { settledCanvas } from '@/lib/settledCanvas';
import { settled } from '@/test/settled';

let scene: Scene | null = null;
function Probe() {
  scene = useThree(state => state.scene);
  return null;
}
// Settles once the canvas has drawn and Html's separate DOM root has committed the witness after it.
const renderedWitness = async () => {
  await settled();
  expect(scene).not.toBeNull();
  return screen.getByTestId('measurement-witness');
};
afterEach(() => {
  cleanup();
  scene = null;
});

it('keeps selected faces and witnesses visible without intercepting the next geometry pick', async () => {
  const selection: MeasureEntity[] = [
    {
      kind: 'face',
      normal: [0, 0, 1],
      triangles: [
        [
          [-1, -1, 0.1],
          [1, -1, 0.1],
          [0, 1, 0.1],
        ],
      ],
    },
    { kind: 'edge', a: [-1, 0, 0.2], b: [1, 0, 0.2] },
    { kind: 'vertex', point: [0, 0, 0.2] },
  ];
  render(
    <div style={{ width: 400, height: 300 }}>
      <Canvas {...settledCanvas} camera={{ position: [0, 0, 5] }}>
        <mesh userData={{ body: true }}>
          <planeGeometry args={[3, 3]} />
          <meshBasicMaterial />
        </mesh>
        <ModelMeasurement selection={selection} witness={{ a: [-1, 0, 0.3], b: [1, 0, 0.3], axis: 'x' }} />
        <Probe />
      </Canvas>
    </div>
  );
  const witness = await renderedWitness();
  expect(witness).toHaveAttribute('data-start', '-1,0,0.3');
  expect(witness).toHaveAttribute('data-end', '1,0,0.3');
  const hits = new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1)).intersectObjects(scene!.children, true);
  expect(hits.length).toBeGreaterThan(0);
  expect(hits.every(hit => hit.object.userData.body)).toBe(true);
  const highlighted: Mesh[] = [];
  scene!.traverse(object => {
    if (object instanceof Mesh && !object.userData.body) highlighted.push(object);
  });
  expect(highlighted.length).toBeGreaterThan(0);
  expect(
    highlighted.every(mesh => {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      return materials.every(material => !material.depthTest && !material.depthWrite);
    })
  ).toBe(true);
});

it('shows a touching-point witness without constructing an undefined zero-length thick line', async () => {
  render(
    <div style={{ width: 400, height: 300 }}>
      <Canvas {...settledCanvas} camera={{ position: [0, 0, 5] }}>
        <ModelMeasurement selection={[]} witness={{ a: [0, 0, 0], b: [0, 0, 0] }} />
        <Probe />
      </Canvas>
    </div>
  );
  await renderedWitness();
  let renderables = 0;
  scene!.traverse(object => {
    if (object instanceof Mesh) renderables++;
  });
  expect(renderables).toBe(0);
});
