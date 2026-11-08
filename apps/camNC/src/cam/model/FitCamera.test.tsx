import { Canvas, useThree } from '@react-three/fiber';
import { render, waitFor } from '@testing-library/react';
import * as THREE from 'three';
import { expect, it } from 'vitest';
import { FitCamera } from './ModelViewport';

let seen: THREE.Camera | null = null;
function Probe() {
  seen = useThree(s => s.camera);
  return null;
}

const box = (size: number) => new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(size, size, size));

function View({ size, fitKey }: { size: number; fitKey: string }) {
  return (
    <div style={{ width: 400, height: 300 }}>
      <Canvas camera={{ fov: 30 }}>
        <FitCamera box={box(size)} fitKey={fitKey} />
        <Probe />
      </Canvas>
    </div>
  );
}

it('leaves the camera where it is when what it shows changes, and fits again only for a new view', async () => {
  const view = render(<View size={100} fitKey="assembled" />);
  await waitFor(() => expect(seen?.position.length()).toBeGreaterThan(0));
  const fitted = seen!.position.clone();
  // A part hidden or edited: the box changes, the camera doesn't.
  view.rerender(<View size={400} fitKey="assembled" />);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(seen!.position.distanceTo(fitted)).toBe(0);
  // Another view, such as exploded, is fitted again.
  view.rerender(<View size={400} fitKey="exploded" />);
  await waitFor(() => expect(seen!.position.distanceTo(fitted)).toBeGreaterThan(1));
});
