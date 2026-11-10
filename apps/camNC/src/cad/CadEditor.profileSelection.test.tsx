import { createPlateDocument, cadSketchFrame, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { page, userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { OrthographicCamera, Vector3 } from 'three';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { CadEditor } from './CadEditor';
import { ModelViewport } from '@/cam/model/ModelViewport';
vi.mock('@/cam/model/ModelViewport', { spy: true });
afterEach(cleanup);

it('selects a sketch region on a solid face and changes the open extrusion to another canvas sketch', async () => {
  await page.viewport(1776, 1115);
  const source = createPlateDocument({ width: 120, height: 80, thickness: 18 });
  const base = source.parts[0]!;
  for (const [name, shift] of [
    ['First', 10],
    ['Second', 65],
  ] as const) {
    const profile = createPlateDocument({ width: 30, height: 25, thickness: 25 }).parts[0]!;
    profile.name = name;
    profile.extrude = false;
    profile.drawnOn = { on: { partId: base.id, face: 'top' }, offset: 0 };
    for (const entity of profile.sketch.entities)
      if (entity.type === 'point') {
        entity.x += shift;
        entity.y += 20;
      }
    source.parts.push(profile);
  }
  let latest: CadDocument = source;
  render(
    <div style={{ height: 800, display: 'flex' }}>
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
  const clickProfile = async (index: number, x: number) => {
    const state = props().cameraState!.current!;
    const canvas = screen.getByTestId('workspace-3d').querySelector('canvas')!;
    const box = canvas.getBoundingClientRect(),
      width = (state.height * box.width) / box.height;
    const camera = new OrthographicCamera(-width / 2, width / 2, state.height / 2, -state.height / 2, 1, 40000);
    camera.position.set(...state.center).addScaledVector(new Vector3(...state.back), 20000);
    camera.up.set(...state.up);
    camera.lookAt(...state.center);
    camera.updateMatrixWorld();
    const frame = cadSketchFrame(source, source.parts[index]!)!;
    const point = new Vector3(...frame.origin)
      .addScaledVector(new Vector3(...frame.x), x)
      .addScaledVector(new Vector3(...frame.y), 32)
      .project(camera);
    await userEvent.click(canvas, { position: { x: ((point.x + 1) * box.width) / 2, y: ((1 - point.y) * box.height) / 2 } });
  };
  try {
    await waitFor(() => expect(props().cameraState?.current?.height).toBeGreaterThan(0), { timeout: 20000 });
    await clickProfile(1, 25);
    await userEvent.click(within(screen.getByRole('toolbar', { name: 'Part Studio toolbar' })).getByRole('button', { name: /^Extrude$/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Extrude · First' });
    expect(within(dialog).getByRole('tab', { name: 'Add' }).getAttribute('aria-selected')).toBe('true');
    await waitFor(() => expect(latest.parts.find(p => p.name === 'First')?.addTo).toBe(base.id));
    const beforeCamera = structuredClone(props().cameraState!.current!);
    await clickProfile(2, 80);
    await waitFor(() => expect(latest.parts.find(p => p.name === 'First')?.sketchOf).toBe(source.parts[2]!.id));
    const first = latest.parts.find(p => p.name === 'First')!;
    expect(first.thickness).toBe(25);
    expect(first.addTo).toBe(base.id);
    expect(latest.parts.some(p => p.extrude === false && p.sketch.id === source.parts[1]!.sketch.id)).toBe(true);
    const after = props().cameraState!.current!;
    expect(after.height).toBeCloseTo(beforeCamera.height, 6);
    for (const key of ['center', 'back', 'up'] as const) after[key].forEach((v, i) => expect(v).toBeCloseTo(beforeCamera[key][i]!, 6));
    await clickProfile(1, 110);
    await waitFor(() => expect(latest.parts.find(p => p.name === 'First')?.faceProfile).toBe(true));
    expect(latest.parts.find(p => p.name === 'First')?.sketchOf).toBeUndefined();
    expect(latest.parts.find(p => p.name === 'First')?.thickness).toBe(25);
    await userEvent.click(within(dialog).getByRole('button', { name: /^Cancel$/ }));
    await waitFor(() => expect(latest.parts).toEqual(source.parts));
  } finally {
    cleanup();
    endCadSession(source.id);
  }
}, 30000);
