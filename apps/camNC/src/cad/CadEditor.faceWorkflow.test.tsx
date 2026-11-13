import {
  cadFaceFacing,
  cadFaceFrame,
  createCadDocument,
  createCadPart,
  designSteps,
  isCadPart,
  parseCadDocument,
  type CadDocument,
  type CadDrawnOn,
} from '@wbcnc/cad';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { page, userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { ModelViewport } from '@/cam/model/ModelViewport';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { settled } from '@/test/settled';
import type { StudioCameraState } from './studioCamera';
import { OrthographicCamera, Vector3 } from 'three';

vi.mock('@/cam/model/ModelViewport', { spy: true });
let sessionId = '';
afterEach(async () => {
  cleanup();
  if (sessionId) endCadSession(sessionId);
  await page.viewport(1280, 800);
});

it('builds three parts with face sketches, then adds a face extrusion up to another face, retaining each manually orbited view', async () => {
  await page.viewport(1776, 1115);
  const source = { ...createCadDocument(), parts: [createCadPart()] };
  sessionId = source.id;
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
  const studioProps = () => vi.mocked(ModelViewport).mock.calls.findLast(([props]) => props.cameraState)![0];
  const camera = () => structuredClone(studioProps().cameraState!.current!);
  const unchanged = async (before: StudioCameraState) =>
    waitFor(() => {
      const after = camera();
      expect(after.height).toBeCloseTo(before.height, 6);
      after.back.forEach((v, i) => expect(v).toBeCloseTo(before.back[i]!, 6));
    });
  const command = (name: string) =>
    userEvent.click(within(screen.getByRole('toolbar', { name: 'Part Studio toolbar' })).getByRole('button', { name }));
  const drawRect = async (a: [number, number], b: [number, number]) => {
    const canvas = screen.getByTestId('cad-canvas');
    canvas.focus();
    await userEvent.keyboard('g');
    for (const [x, y] of [a, b]) {
      const matrix = (screen.getByTestId('cad-drawing') as unknown as SVGGraphicsElement).getScreenCTM()!;
      const point = new DOMPoint(x, -y).matrixTransform(matrix),
        box = canvas.getBoundingClientRect();
      await userEvent.click(canvas, { position: { x: point.x - box.left, y: point.y - box.top } });
    }
    await userEvent.keyboard('{Escape}');
    await settled();
    await userEvent.click(screen.getByRole('button', { name: '✓ Finish sketch' }));
    await settled();
  };
  const thickness = async (value: string) => {
    const field = screen.getByRole('textbox', { name: 'Thickness' });
    await userEvent.clear(field);
    await userEvent.type(field, value);
    await userEvent.keyboard('{Tab}');
    await settled();
  };
  // A confirmed sketch's Extrude starts with nothing picked: its region is picked in the view.
  const pickRegion = async () => {
    const view = studioProps().regions!.find(region => !region.picked)!;
    act(() => studioProps().onPickRegion!(view.id));
    await settled();
  };
  const ok = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    await settled();
  };
  const faceFacing = (partId: string, way: '+x' | '+y') => {
    const face = cadFaceFacing(latest, partId, way);
    if ('error' in face) throw new Error(face.error);
    return { partId, face: face.face };
  };
  const clickFace = async (on: Extract<CadDrawnOn['on'], { partId: string }>, u: number, v: number) => {
    const frame = cadFaceFrame(latest, on);
    if ('error' in frame) throw new Error(frame.error);
    const canvas = screen.getByTestId('workspace-3d').querySelector('canvas')!,
      box = canvas.getBoundingClientRect();
    const state = camera(),
      width = (state.height * box.width) / box.height;
    const projection = new OrthographicCamera(-width / 2, width / 2, state.height / 2, -state.height / 2, 1, 40000);
    projection.position.set(...state.center).addScaledVector(new Vector3(...state.back), 20000);
    projection.up.set(...state.up);
    projection.lookAt(...state.center);
    projection.updateMatrixWorld();
    const point = new Vector3(...frame.origin)
      .addScaledVector(new Vector3(...frame.x), u)
      .addScaledVector(new Vector3(...frame.y), v)
      .project(projection);
    await userEvent.click(canvas, { position: { x: ((point.x + 1) * box.width) / 2, y: ((1 - point.y) * box.height) / 2 } });
    await settled();
  };
  const orbit = async (dx: number, dy: number) => {
    const before = camera(),
      canvas = screen.getByTestId('workspace-3d').querySelector('canvas')!;
    vi.spyOn(canvas, 'setPointerCapture').mockImplementation(() => {});
    const box = canvas.getBoundingClientRect(),
      x = box.left + box.width * 0.7,
      y = box.top + box.height * 0.6;
    const pointer = (type: string, factor: number, buttons: number) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 1,
          pointerType: 'mouse',
          button: 2,
          buttons,
          clientX: x + dx * factor,
          clientY: y + dy * factor,
        })
      );
    pointer('pointerdown', 0, 2);
    pointer('pointermove', 0.5, 2);
    pointer('pointermove', 1, 2);
    pointer('pointerup', 1, 0);
    // Damping must have settled before testing whether the next command moves the view. The drag turns the camera on
    // the next drawn frame, and damping eases the rest of the turn in over about 45 more, each requested by the
    // controls; the view publishes its camera as it draws. The settled signal counts the view as pending while it has a
    // frame requested, so it is quiet once the controls stop moving the camera (by less than 1e-7 still to come). A
    // loaded CI page draws a frame in a few hundred ms, so the glide alone can outlast the default 10 s, as it did when
    // this waited a fixed 10 s for a frame-to-frame drift below 1e-8 (#575).
    await settled({ timeout: 30_000 });
    expect(camera().back).not.toEqual(before.back);
  };
  const orbitTo = async (direction: [number, number, number]) => {
    const before = camera().back,
      target = new Vector3(...direction).normalize();
    const height = screen.getByTestId('workspace-3d').querySelector('canvas')!.clientHeight;
    const angle = Math.atan2(target.y, target.x) - Math.atan2(before[1], before[0]);
    const theta = Math.atan2(Math.sin(angle), Math.cos(angle));
    await orbit((-theta * height) / (2 * Math.PI), (-(Math.acos(target.z) - Math.acos(before[2])) * height) / (2 * Math.PI));
  };
  await waitFor(() => expect(studioProps().cameraState?.current?.height).toBeGreaterThan(0), { timeout: 20000 });
  const initial = camera();
  await userEvent.click(within(screen.getByRole('list', { name: 'Default geometry' })).getByRole('button', { name: 'Front' }));
  await command('Sketch');
  await settled();
  await drawRect([0, 0], [57, 63]);
  await unchanged(initial);
  await command('Extrude');
  await pickRegion();
  await thickness('25');
  await ok();
  await unchanged(initial);
  const first = latest.parts[0]!.id;
  await clickFace({ partId: first, face: 'top' }, 20, 55);
  await command('Sketch');
  await settled();
  await drawRect([0, 48], [57, 63]);
  await unchanged(initial);
  await command('Extrude');
  await pickRegion();
  // Add has its own depth and end condition when it joins another sketch's body.
  expect(screen.getByRole('tab', { name: 'Add' }).getAttribute('aria-selected')).toBe('true');
  await thickness('65.7');
  await userEvent.click(screen.getByRole('tab', { name: 'New' }));
  await orbitTo([1, -0.6, 0.25]);
  const secondView = camera();
  await ok();
  await unchanged(secondView);
  await clickFace(faceFacing(first, '+x'), 30, 12);
  await command('Sketch');
  await settled();
  await drawRect([0, 25], [63, 90.7]);
  await unchanged(secondView);
  await command('Extrude');
  await pickRegion();
  expect((screen.getByRole('combobox', { name: 'Merge scope' }) as HTMLSelectElement).value).toBe(latest.parts[1]!.id);
  await thickness('3');
  await userEvent.click(screen.getByRole('button', { name: 'Flip direction' }));
  await userEvent.click(screen.getByRole('button', { name: 'Flip direction' }));
  await orbitTo([0.275, 1, 0.03]);
  const thirdView = camera();
  expect(thirdView.back[1]).toBeGreaterThan(0.9);
  await userEvent.click(screen.getByRole('tab', { name: 'New' }));
  await ok();
  await unchanged(thirdView);
  const side = latest.parts[2]!.id;
  const rearFace = faceFacing(side, '+y');
  await clickFace(rearFace, 31.5, 1.5);
  await command('Extrude');
  await settled();
  await unchanged(thirdView);
  expect(latest.parts[3]!.faceProfile).toBe(true);
  expect(latest.parts[3]!.drawnOn?.on).toEqual(rearFace);
  expect(latest.parts[3]!.thickness).toBe(25);
  expect(screen.queryByRole('button', { name: 'Edit sketch' })).toBeNull();
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'End type' }), 'upTo');
  await clickFace({ partId: first, face: 'underside' }, -28.5, 31.5);
  await waitFor(() => expect(latest.parts[3]!.thickness).toBeCloseTo(25, 3));
  await userEvent.click(screen.getByRole('tab', { name: 'Add' }));
  expect(screen.getByRole('alert').textContent).toMatch(/merge scope/);
  expect(latest.parts.filter(isCadPart)).toHaveLength(3);
  expect(screen.getByRole('button', { name: 'OK' })).toHaveProperty('disabled', true);
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Merge scope' }), side);
  await ok();
  await unchanged(thirdView);
  expect(latest.parts.filter(isCadPart)).toHaveLength(3);
  expect(designSteps(latest).map(step => step.kind)).toEqual(['sketch', 'extrude', 'sketch', 'extrude', 'sketch', 'extrude', 'extrude']);
  expect(parseCadDocument(JSON.parse(JSON.stringify(latest))).parts[3]).toMatchObject({
    faceProfile: true,
    addTo: side,
    upTo: { partId: first, face: 'underside' },
  });
  // About 20 s alone and 35–47 s with four pages on four CPUs, as a CI shard runs them: each orbit's glide is drawn
  // frame by frame, and a loaded page draws one in a few hundred ms.
}, 120_000);
