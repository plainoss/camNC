import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { BoxGeometry, Matrix4, Vector3 } from 'three';
import { ModelViewport } from './ModelViewport';
import type { BodyMesh, CamPartInfo } from '../camTypes';
import type { StudioCameraRef } from '@/cad/studioCamera';

afterEach(cleanup);

it('keeps an off-center point on a studio body fixed during right-drag', async () => {
  const geometry = new BoxGeometry(200, 120, 40);
  const mesh: BodyMesh = {
    name: 'Plate',
    partId: 'plate',
    flat: new Matrix4().toArray(),
    positions: new Float32Array(geometry.getAttribute('position').array),
    indices: new Uint32Array(geometry.index!.array),
  };
  geometry.dispose();
  const part: CamPartInfo = {
    id: 'plate',
    name: 'Plate',
    names: ['Plate'],
    size: [200, 120, 40],
    thickness: 40,
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
  };
  const cameraState: StudioCameraRef = { current: null };
  const host = render(
    <div style={{ width: 600, height: 400 }}>
      <ModelViewport
        meshes={[mesh]}
        parts={[part]}
        view="assembled"
        selectedId={null}
        milled={() => true}
        onSelect={() => {}}
        palette="studio"
        cameraState={cameraState}
        viewRequest={{ name: 'top', seq: 1 }}
      />
    </div>
  );
  await waitFor(() => expect(cameraState.current?.seq).toBe(1));
  const canvas = host.container.querySelector('canvas')!;
  const rect = canvas.getBoundingClientRect();
  const point = new Vector3(65, 30, 20);
  const project = () => {
    const state = cameraState.current!;
    const up = new Vector3(...state.up);
    const right = up.clone().cross(new Vector3(...state.back));
    const delta = point.clone().sub(new Vector3(...state.center));
    const scale = rect.height / state.height;
    return { x: rect.left + rect.width / 2 + delta.dot(right) * scale, y: rect.top + rect.height / 2 - delta.dot(up) * scale };
  };
  const before = project();
  const initialBack = new Vector3(...cameraState.current!.back);
  const pointer = (type: string, dx: number, dy: number) =>
    canvas.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerType: 'mouse',
        pointerId: 1,
        button: 2,
        buttons: type === 'pointerup' ? 0 : 2,
        clientX: before.x + dx,
        clientY: before.y + dy,
      })
    );
  pointer('pointerdown', 0, 0);
  pointer('pointermove', 40, 20);
  pointer('pointerup', 40, 20);
  await waitFor(() => expect(new Vector3(...cameraState.current!.back).distanceTo(initialBack)).toBeGreaterThan(0.1));
  expect(Math.hypot(project().x - before.x, project().y - before.y)).toBeLessThan(0.01);
});
