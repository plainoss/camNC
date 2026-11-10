import { createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { page, userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { OrthographicCamera, Vector3 } from 'three';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { CadEditor } from './CadEditor';
import { ModelViewport } from '@/cam/model/ModelViewport';
vi.mock('@/cam/model/ModelViewport', { spy: true });
afterEach(cleanup);

it.each(['normal', 'symmetric', 'flipped', 'add'])(
  'drags extrusion depth as one edit without moving the camera (%s)',
  async mode => {
    const source = createPlateDocument({ width: 120, height: 80, thickness: 25.73 });
    await page.viewport(1776, 1115);
    source.parts[0]!.drawnOn = { on: { plane: 'front' }, offset: 0, inward: mode === 'flipped' };
    if (mode === 'symmetric') source.parts[0]!.symmetric = true;
    source.parts[0]!.thicknessExpression = '25.73';
    if (mode === 'add') {
      const target = createPlateDocument({ width: 120, height: 80, thickness: 18 }).parts[0]!;
      target.name = 'Support';
      target.drawnOn = { on: { plane: 'front' }, offset: 0 };
      source.parts[0]!.addTo = target.id;
      source.parts[0]!.drawnOn = { on: { plane: 'front' }, offset: 18 };
      source.parts.unshift(target);
    }
    const selected = () => latest.parts.find(part => part.name === 'Plate')!;
    let latest: CadDocument = source;
    render(
      <div style={{ height: 700, display: 'flex' }}>
        <CadEditor
          document={source}
          startIn3D
          onDraftChange={value => {
            latest = value;
          }}
          onFinish={() => {}}
          onCancel={() => {}}
        />
      </div>
    );
    const props = () => vi.mocked(ModelViewport).mock.calls.findLast(([value]) => value.cameraState)![0];
    try {
      await waitFor(() => expect(props().cameraState?.current?.height).toBeGreaterThan(0), { timeout: 20000 });
      await userEvent.dblClick(screen.getByRole('button', { name: /^Extrude · Plate/ }));
      const arrow = await screen.findByRole('spinbutton', { name: 'Extrusion depth' });
      await userEvent.click(arrow);
      expect(selected().thickness).toBe(25.73);
      expect(selected().thicknessExpression).toBe('25.73');
      const field = screen.getByRole('textbox', { name: 'Thickness' });
      await userEvent.clear(field);
      await userEvent.type(field, 'invalid');
      const planePositions = () =>
        ['Top', 'Front', 'Right'].map(name =>
          within(screen.getByTestId('workspace-3d')).getByText(name, { exact: true }).getBoundingClientRect().toJSON()
        );
      const beforePlanes = planePositions();
      const before = structuredClone(props().cameraState!.current!);
      const control = props().extrusionDepth!;
      const canvas = screen.getByTestId('workspace-3d').querySelector('canvas')!;
      const box = canvas.getBoundingClientRect(),
        width = (before.height * box.width) / box.height;
      const camera = new OrthographicCamera(-width / 2, width / 2, before.height / 2, -before.height / 2, 1, 40000);
      camera.position.set(...before.center).addScaledVector(new Vector3(...before.back), 20000);
      camera.up.set(...before.up);
      camera.lookAt(...before.center);
      camera.updateMatrixWorld();
      const target = new Vector3(...control.origin)
        .addScaledVector(new Vector3(...control.direction), 282.4 / control.factor + 8)
        .project(camera);
      await userEvent.dragAndDrop(arrow, canvas, {
        targetPosition: { x: ((target.x + 1) * box.width) / 2, y: ((1 - target.y) * box.height) / 2 },
      });
      await waitFor(() => expect(selected().thickness).toBeCloseTo(282.4, 0));
      expect(selected().thicknessExpression).toBeUndefined();
      expect(Number((screen.getByRole('textbox', { name: 'Thickness' }) as HTMLInputElement).value)).toBeCloseTo(282.4, 0);
      // The HTML plane labels follow the rendered scene in useFrame, after the document commit.
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      planePositions().forEach((rect, index) => {
        expect(rect.left).toBeCloseTo(beforePlanes[index]!.left, 2);
        expect(rect.top).toBeCloseTo(beforePlanes[index]!.top, 2);
      });
      const after = props().cameraState!.current!;
      for (const key of ['center', 'back', 'up'] as const) after[key].forEach((v, i) => expect(v).toBeCloseTo(before[key][i]!, 6));
      expect(after.height).toBeCloseTo(before.height, 6);
      await userEvent.click(screen.getByRole('button', { name: 'Undo (Ctrl or Command Z)' }));
      await waitFor(() => expect(selected().thickness).toBe(25.73));
      expect(selected().thicknessExpression).toBe('25.73');
    } finally {
      cleanup();
      endCadSession(source.id);
    }
  },
  30000
);
