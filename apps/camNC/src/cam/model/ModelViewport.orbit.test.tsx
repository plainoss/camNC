import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { BoxGeometry, Matrix4, Vector3 } from 'three';
import { ModelViewport } from './ModelViewport';
import type { BodyMesh, CamPartInfo } from '../camTypes';
import type { StudioCameraRef } from '@/cad/studioCamera';

afterEach(cleanup);

it.each(['face', 'background with a construction plane', 'planes only after panning'] as const)(
  'keeps the correct model point fixed for a right-drag on %s',
  async mode => {
    const geometry = new BoxGeometry(200, 120, 40);
    geometry.translate(300, 200, 100);
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
          meshes={mode === 'planes only after panning' ? [] : [mesh]}
          parts={mode === 'planes only after panning' ? [] : [part]}
          view="assembled"
          selectedId={null}
          milled={() => true}
          onSelect={() => {}}
          palette="studio"
          planes={mode === 'face' ? [] : [{ id: 'top', label: 'Top', origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] }]}
          cameraState={cameraState}
          viewRequest={{ name: 'top', seq: 1 }}
        />
      </div>
    );
    await waitFor(() => expect(cameraState.current?.seq).toBe(1), { timeout: 20000 });
    const canvas = host.container.querySelector('canvas')!;
    const rect = canvas.getBoundingClientRect();
    const point =
      mode === 'face' ? new Vector3(365, 230, 120) : mode === 'planes only after panning' ? new Vector3() : new Vector3(300, 200, 100);
    const project = () => {
      const state = cameraState.current!;
      const up = new Vector3(...state.up);
      const right = up.clone().cross(new Vector3(...state.back));
      const delta = point.clone().sub(new Vector3(...state.center));
      const scale = rect.height / state.height;
      return { x: rect.left + rect.width / 2 + delta.dot(right) * scale, y: rect.top + rect.height / 2 - delta.dot(up) * scale };
    };
    if (mode === 'planes only after panning') {
      for (const [type, dx] of [
        ['pointerdown', 0],
        ['pointermove', 40],
        ['pointerup', 40],
      ] as const)
        canvas.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerType: 'mouse',
            pointerId: 1,
            button: 1,
            buttons: type === 'pointerup' ? 0 : 4,
            clientX: rect.left + rect.width / 2 + dx,
            clientY: rect.top + rect.height / 2,
          })
        );
      await waitFor(() => expect(new Vector3(...cameraState.current!.center).length()).toBeGreaterThan(1));
    }
    const before = project();
    const start = mode === 'face' ? before : { x: rect.left + 10, y: rect.top + 10 };
    const initialBack = new Vector3(...cameraState.current!.back);
    const pointer = (type: string, dx: number, dy: number) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerType: 'mouse',
          pointerId: 1,
          button: 2,
          buttons: type === 'pointerup' ? 0 : 2,
          clientX: start.x + dx,
          clientY: start.y + dy,
        })
      );
    pointer('pointerdown', 0, 0);
    pointer('pointermove', 40, 20);
    pointer('pointerup', 40, 20);
    await waitFor(() => expect(new Vector3(...cameraState.current!.back).distanceTo(initialBack)).toBeGreaterThan(0.1));
    expect(Math.hypot(project().x - before.x, project().y - before.y)).toBeLessThan(0.01);
  }
);
