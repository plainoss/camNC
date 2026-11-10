import { cadFaceFrame, createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { page, userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from '@wbcnc/cad-editor/session';

import { OrthographicCamera, Vector3 } from 'three';
import { ModelViewport } from '@/cam/model/ModelViewport';
vi.mock('@/cam/model/ModelViewport', { spy: true });

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});
const settled = () =>
  waitFor(() => expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false'), { timeout: 20_000 });

it('mirrors the selected part across a picked plane, and changes the plane from its step', async () => {
  const source = createPlateDocument({ width: 100, height: 60 });
  source.parts[0]!.placement = { position: [30, 0, 0], rotation: [0, 0, 0, 1] };
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={change} onFinish={vi.fn()} onCancel={() => {}} />
    </div>
  );
  await settled();
  const latest = () => change.mock.calls.at(-1)?.[0] ?? source;
  const toolbar = await screen.findByRole('toolbar', { name: 'Part Studio toolbar' });
  const features = screen.getByRole('region', { name: 'Features' });
  const geometry = within(features).getByRole('list', { name: 'Default geometry' });
  await userEvent.click(within(toolbar).getByRole('button', { name: /^Mirror/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Mirror' });
  // The mirror plane is picked straight away.
  expect(within(dialog).getByRole('button', { name: 'Mirror plane' }).hasAttribute('data-active')).toBe(true);
  await userEvent.click(within(geometry).getByRole('button', { name: /Right/ }));
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Mirror plane' }).textContent).toContain('right plane'));
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(latest().parts[0]!.copies).toHaveLength(1));
  const copy = latest().parts[0]!.copies![0]!;
  expect(copy).toMatchObject({ mirrored: true, mirror: { across: { plane: 'right' } } });
  await waitFor(() => expect(latest().parts[0]!.copies![0]!.placement!.position[0]).toBeCloseTo(-30, 6));
  // Its step opens it again, to mirror across another plane.
  await userEvent.dblClick(await within(features).findByRole('button', { name: /Plate 2|copy|Copy/ }));
  const again = await screen.findByRole('dialog', { name: 'Mirror' });
  await userEvent.click(within(again).getByRole('button', { name: 'Mirror plane' }));
  await userEvent.click(within(geometry).getByRole('button', { name: /Front/ }));
  await userEvent.click(within(again).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(latest().parts[0]!.copies![0]!.mirror).toEqual({ across: { plane: 'front' } }));
});

it('uses another part face as the mirror plane', async () => {
  await page.viewport(1776, 1115);
  const source = createPlateDocument({ width: 100, height: 60 });
  const original = source.parts[0]!;
  original.placement = { position: [30, 0, 0], rotation: [0, 0, 0, 1] };
  const support = createPlateDocument({ width: 100, height: 60, thickness: 18 }).parts[0]!;
  support.name = 'Support';
  support.placement = { position: [0, 0, 100], rotation: [0, 0, 0, 1] };
  source.parts.push(support);
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={change} onFinish={vi.fn()} onCancel={() => {}} />
    </div>
  );
  await settled();
  // Spy calls survive the previous fixture; only this support body's viewport can supply its camera.
  const props = () =>
    vi
      .mocked(ModelViewport)
      .mock.calls.findLast(([props]) => props.cameraState && props.meshes.some(mesh => mesh.partId === support.id))?.[0];
  const toolbar = await screen.findByRole('toolbar', { name: 'Part Studio toolbar' });
  await userEvent.click(within(toolbar).getByRole('button', { name: /^Mirror/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Mirror' });
  const frame = cadFaceFrame(source, { partId: support.id, face: 'top' });
  if ('error' in frame) throw new Error(frame.error);
  // The lazy model canvas publishes its camera after the editor is ready, including under parallel renderer load.
  await waitFor(() => expect(props()?.cameraState?.current?.height).toBeGreaterThan(0), { timeout: 20_000 });
  const canvas = screen.getByTestId('workspace-3d').querySelector('canvas')!;
  const box = canvas.getBoundingClientRect();
  const state = props()!.cameraState!.current!;
  const width = (state.height * box.width) / box.height;
  const projection = new OrthographicCamera(-width / 2, width / 2, state.height / 2, -state.height / 2, 1, 40000);
  projection.position.set(...state.center).addScaledVector(new Vector3(...state.back), 20000);
  projection.up.set(...state.up);
  projection.lookAt(...state.center);
  projection.updateMatrixWorld();
  const point = new Vector3(...frame.origin)
    .addScaledVector(new Vector3(...frame.x), 50)
    .addScaledVector(new Vector3(...frame.y), 30)
    .project(projection);
  await userEvent.click(canvas, { position: { x: ((point.x + 1) * box.width) / 2, y: ((1 - point.y) * box.height) / 2 } });
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Mirror plane' }).textContent).toContain('Support'));
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() =>
    expect(change.mock.calls.at(-1)?.[0].parts[0]!.copies?.[0]?.mirror).toEqual({
      across: { partId: support.id, face: 'top' },
    })
  );
  expect(change.mock.calls.at(-1)![0].parts[0]!.copies![0]!.placement!.position[2]).toBeCloseTo(236, 6);
}, 40_000);
