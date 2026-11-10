import { cadPartReference, parseCadDocument, type CadDocument } from '@wbcnc/cad';
import { OrthographicCamera, Vector3 } from 'three';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { page, userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { ModelViewport } from '@/cam/model/ModelViewport';
import { endCadSession } from '@wbcnc/cad-editor/session';
import saved from '../../../../packages/cad-script/fixtures/designs/shelf-mirror-face.json';

vi.mock('@/cam/model/ModelViewport', { spy: true });
let sessionId = '';
afterEach(async () => {
  cleanup();
  if (sessionId) endCadSession(sessionId);
  await page.viewport(1280, 800);
});

it.each([0, 1, 2])('mirrors the cabinet side using shelf %s’s narrow end face and preserves the physical reference', async shelfIndex => {
  await page.viewport(1776, 1115);
  const source = parseCadDocument(structuredClone(saved));
  sessionId = source.id;
  const shelf = source.parts[0]!,
    side = source.parts[1]!;
  let latest: CadDocument = source;
  render(
    <div style={{ height: 900, display: 'flex' }}>
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
  await waitFor(() => expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false'), { timeout: 20000 });
  const props = () => vi.mocked(ModelViewport).mock.calls.findLast(([props]) => props.cameraState)![0];
  await waitFor(() => expect(props().cameraState?.current?.height).toBeGreaterThan(0), { timeout: 20000 });
  // Select the cabinet side without changing the shelf that will supply the plane.
  const sideIndex = props().instanceIds!.indexOf(side.id);
  act(() => props().onSelect(side.id, sideIndex));
  await userEvent.click(within(screen.getByRole('toolbar', { name: 'Part Studio toolbar' })).getByRole('button', { name: /^Mirror/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Mirror' });
  const copyId = shelfIndex ? shelf.copies![shelfIndex - 1]!.id : undefined;
  const reference = cadPartReference(shelf.id, copyId);
  const instance = copyId ? `${shelf.id}/${copyId}` : shelf.id;
  const index = props().instanceIds!.indexOf(instance);
  expect(index).toBeGreaterThanOrEqual(0);
  expect(props().onPickFace).toBeTypeOf('function');
  if (shelfIndex === 2) {
    act(() => props().onViewRequest!({ name: 'back' }));
    await waitFor(() => expect(props().cameraState!.current!.back[1]).toBeCloseTo(1, 5));
    const state = props().cameraState!.current!;
    const canvas = screen.getByTestId('workspace-3d').querySelector('canvas')!;
    const box = canvas.getBoundingClientRect();
    const width = (state.height * box.width) / box.height;
    const camera = new OrthographicCamera(-width / 2, width / 2, state.height / 2, -state.height / 2, 1, 40000);
    camera.position.set(...state.center).addScaledVector(new Vector3(...state.back), 20000);
    camera.up.set(...state.up);
    camera.lookAt(...state.center);
    camera.updateMatrixWorld();
    const point = new Vector3(0, 600, 609.5).project(camera);
    await userEvent.click(canvas, { position: { x: ((point.x + 1) * box.width) / 2, y: ((1 - point.y) * box.height) / 2 } });
  } else {
    act(() => props().onPickFace!({ partId: shelf.id, index, point: [0, 600, shelfIndex * 300 + 9.5], normal: [0, 1, 0] }));
  }
  const plane = within(dialog).getByRole('button', { name: 'Mirror plane' });
  await waitFor(() => expect(plane.textContent).toContain(shelfIndex ? `Part 1 ${shelfIndex + 1}` : 'Part 1'));
  expect(within(dialog).getByText('Part 2', { exact: true })).toBeTruthy();
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(latest.parts[1]!.copies).toHaveLength(1));
  const mirror = latest.parts[1]!.copies![0]!;
  expect(mirror.mirror).toEqual({ across: { partId: reference, face: { edge: '1ae808ee-7445-47ed-a11f-8a0b26cca6ff' } } });
  expect(mirror.placement!.position[1]).toBeCloseTo(1200, 6);
  expect(latest.parts[0]!.copies).toHaveLength(2);
  const restored = parseCadDocument(JSON.parse(JSON.stringify(latest)));
  expect(restored.parts[1]!.copies![0]!.mirror).toEqual(mirror.mirror);
});
