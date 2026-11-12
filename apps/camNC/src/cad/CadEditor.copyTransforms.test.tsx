import { addLine, createCadPart, parseCadDocument, type CadDocument } from '@wbcnc/cad';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { page, userEvent } from '@vitest/browser/context';
import { createRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ModelViewport } from '@/cam/model/ModelViewport';
import { nativeCadModel } from '@/cam/nativeCadModel';
import { boundaryVolume, orderedCopyFixture } from '@/test/orderedCopyFixture';
import { settled } from '@/test/settled';
import { CadEditor, type CadEditorController } from './CadEditor';

vi.mock('@/cam/model/ModelViewport', { spy: true });
const sessions = new Set<string>();
afterEach(async () => {
  cleanup();
  sessions.forEach(endCadSession);
  sessions.clear();
  await page.viewport(1280, 800);
});

async function open(source: CadDocument) {
  await page.viewport(1776, 1115);
  sessions.add(source.id);
  const controller = createRef<CadEditorController>(),
    change = vi.fn<(document: CadDocument) => void>();
  const mounted = render(
    <div style={{ height: 900, display: 'flex' }}>
      <CadEditor document={source} controller={controller} startIn3D onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  await waitFor(() => expect(document.querySelector('.cad-editor')).toHaveAttribute('aria-busy', 'false'), { timeout: 20_000 });
  const frame = await screen.findByTestId('workspace-3d', {}, { timeout: 20_000 });
  const props = () =>
    vi
      .mocked(ModelViewport)
      .mock.calls.findLast(([props]) => props.cameraState && props.meshes.some(mesh => mesh.partId === source.parts[0]!.id))![0];
  await waitFor(() => expect(props().cameraState!.current?.height).toBeGreaterThan(0), { timeout: 20_000 });
  const top = async () => {
    frame.focus();
    await userEvent.keyboard('{Shift>}5{/Shift}');
    await waitFor(() => expect(props().cameraState!.current!.back[2]).toBeCloseTo(1, 6), { timeout: 20_000 });
  };
  const click = async (point: [number, number, number]) => {
    const canvas = frame.querySelector('canvas')!,
      box = canvas.getBoundingClientRect();
    const { back, up, center, height } = props().cameraState!.current!;
    const right = [up[1] * back[2] - up[2] * back[1], up[2] * back[0] - up[0] * back[2], up[0] * back[1] - up[1] * back[0]];
    const delta = point.map((value, axis) => value - center[axis]!);
    const dot = (axis: number[]) => axis.reduce((sum, value, index) => sum + value * delta[index]!, 0);
    await userEvent.click(canvas, {
      position: { x: box.width / 2 + (dot(right) * box.height) / height, y: box.height / 2 - (dot(up) * box.height) / height },
    });
  };
  // prepareDocument returns null while the editor is busy or solving, as it is for a moment after a click or an Undo,
  // so the document is only prepared once the editor is idle. The settled signal counts the solve from when it starts,
  // and stays pending for two frames after a change, so it also covers the render that commits a new revision before
  // the effect that starts its check runs (the status line still reads idle then).
  const prepare = async () => {
    await settled({ timeout: 20_000 });
    let value: CadDocument | null = null;
    act(() => {
      value = controller.current!.prepareDocument();
    });
    if (!value) throw Error('The current source was not ready to save.');
    return value as CadDocument;
  };
  return {
    ...mounted,
    controller,
    frame,
    props,
    click,
    top,
    settled: () => settled({ timeout: 20_000 }),
    prepare,
    latest: () => change.mock.calls.at(-1)?.[0] ?? source,
  };
}

// These workflows include actual lazy-renderer readiness, worker solving and a second imported renderer lifecycle.
it.each([false, true])(
  'imports, inspects, saves, undoes and reloads an ordered copy without accumulating its move, mirrored=%s',
  async mirrored => {
    const f = orderedCopyFixture(mirrored),
      bytes = JSON.stringify(f.document);
    const first = await open(parseCadDocument(JSON.parse(bytes)));
    await first.top();
    await first.click([mirrored ? 250 : 350, 40, 18]);
    const measurement = await screen.findByRole('region', { name: 'Selection measurements' });
    expect(within(measurement).getByRole('button', { name: 'Area: 5500 mm²' })).toBeVisible();
    expect(first.props().selectedFace?.point).toEqual([300, 0, 18]);
    const index = first.props().instanceIds!.indexOf(`${f.partId}/${f.copyId}`);
    expect(first.props().selectedFace?.index).toBe(index);
    expect(boundaryVolume(first.props().meshes[index]!.positions, first.props().meshes[index]!.indices)).toBe(99000);
    expect(screen.getByRole('button', { name: 'Undo (Ctrl or Command Z)' })).toBeDisabled();
    const before = await first.prepare();
    expect(before.parts[0]!.copies![0]!.placement!.position).toEqual([200, 0, 0]);
    expect(before.operationOrder).toEqual([f.cutA, f.move, f.cutB]);
    act(() => {
      expect(first.controller.current!.updateSettings({ name: 'Imported copy edit', lengthUnit: before.lengthUnit })).toBe(true);
    });
    await first.settled();
    expect(first.latest().name).toBe('Imported copy edit');
    await userEvent.click(screen.getByRole('button', { name: 'Undo (Ctrl or Command Z)' }));
    await first.settled();
    expect((await first.prepare()).name).toBe(before.name);
    expect(screen.getByRole('button', { name: 'Undo (Ctrl or Command Z)' })).toBeDisabled();
    // Save to file uses this same controller preparation plus portable JSON serialization.
    const portable = parseCadDocument(JSON.parse(JSON.stringify(await first.prepare())));
    expect(portable.parts[0]!.copies![0]!.placement!.position).toEqual([200, 0, 0]);
    expect(portable.copyTransforms).toEqual(f.document.copyTransforms);
    first.unmount();
    endCadSession(portable.id);
    const reloaded = await open(portable);
    await reloaded.top();
    await reloaded.click([mirrored ? 250 : 350, 40, 18]);
    expect(await screen.findByRole('button', { name: 'Area: 5500 mm²' })).toBeVisible();
    expect(reloaded.props().selectedFace?.point).toEqual([300, 0, 18]);
    expect((await reloaded.prepare()).parts[0]!.copies![0]!.placement!.position).toEqual([200, 0, 0]);
    const cam = await nativeCadModel(portable),
      part = cam.model.parts.findIndex(part => part.names?.includes('Panel 2'));
    expect(boundaryVolume(cam.model.meshes[part]!.positions, cam.model.meshes[part]!.indices)).toBe(99000);
    expect(JSON.stringify(f.document)).toBe(bytes);
  },
  60_000
);

it('picks a destination mate connector from the moved physical copy and cancels without a source edit', async () => {
  const f = orderedCopyFixture(),
    before = JSON.stringify(f.document),
    view = await open(f.document);
  await view.top();
  const parts = within(screen.getByRole('region', { name: 'Parts panel' }));
  await userEvent.click(parts.getByRole('button', { name: /^Knife A/ }));
  await userEvent.click(within(screen.getByRole('toolbar', { name: 'Part Studio toolbar' })).getByRole('button', { name: 'Transform' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Transform type' }), { target: { value: 'mate' } });
  await view.click([205, 10, 18]);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Mate connector to move to' })).toHaveAttribute('data-active'));
  await view.click([350, 30, 18]);
  await waitFor(() =>
    expect(view.props().connectors).toContainEqual(expect.objectContaining({ label: 'Destination mate connector', point: [350, 30, 18] }))
  );
  await userEvent.click(within(screen.getByRole('dialog', { name: /^Transform/ })).getByRole('button', { name: 'Cancel' }));
  await view.settled();
  expect((await view.prepare()).copyTransforms).toEqual(f.document.copyTransforms);
  expect((await view.prepare()).parts[0]!.copies![0]!.placement!.position).toEqual([200, 0, 0]);
  expect(screen.getByRole('button', { name: 'Undo (Ctrl or Command Z)' })).toBeDisabled();
  expect(JSON.stringify(f.document)).toBe(before);
}, 40_000);

it('uses generation-stage backdrop geometry before later copy operations and saves stable source references', async () => {
  const f = orderedCopyFixture(),
    target = createCadPart('Reference sketch');
  target.extrude = false;
  target.drawnOn = { on: { plane: 'top' }, offset: 18 };
  target.sketch = addLine(target.sketch, { x1: -50, y1: -40, x2: 550, y2: -40 });
  const source = { ...f.document, parts: [...f.document.parts, target] },
    before = JSON.stringify(source),
    view = await open(source);
  await userEvent.dblClick(
    within(screen.getByRole('region', { name: 'Features' })).getByRole('button', { name: 'Sketch · Reference sketch' })
  );
  await screen.findByRole('dialog', { name: 'Sketch · Reference sketch' });
  const svg = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  svg.focus();
  await userEvent.keyboard('nf');
  let edge: SVGLineElement | undefined;
  await waitFor(
    () => {
      edge = [...document.querySelectorAll<SVGLineElement>('.cad-part-edge')].find(
        edge => edge.dataset.partCopy === f.copyId && Number(edge.getAttribute('y1')) === -60 && Number(edge.getAttribute('y2')) === -60
      );
      expect(edge).toBeDefined();
      expect([Number(edge!.getAttribute('x1')), Number(edge!.getAttribute('x2'))].sort((a, b) => a - b)).toEqual([200, 300]);
    },
    { timeout: 20_000 }
  );
  await userEvent.keyboard('u');
  const point = svg.createSVGPoint();
  point.x = 250;
  point.y = -60;
  const at = point.matrixTransform(edge!.getScreenCTM()!),
    box = svg.getBoundingClientRect();
  expect(document.elementFromPoint(at.x, at.y)).toBe(edge);
  await userEvent.click(svg, { position: { x: at.x - box.left, y: at.y - box.top } });
  const references = () =>
    view
      .latest()
      .parts.find(part => part.id === target.id)!
      .sketch.entities.filter(entity => entity.type === 'point' && entity.used);
  await waitFor(() => expect(references()).toHaveLength(2));
  expect(references()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ x: 200, y: 60, used: expect.objectContaining({ partId: f.partId, copyId: f.copyId }) }),
      expect.objectContaining({ x: 300, y: 60, used: expect.objectContaining({ partId: f.partId, copyId: f.copyId }) }),
    ])
  );
  const saved = parseCadDocument(JSON.parse(JSON.stringify(await view.prepare())));
  expect(saved.operationOrder).toEqual([f.cutA, f.move, f.cutB]);
  expect(saved.parts[0]!.copies![0]!.placement!.position).toEqual([200, 0, 0]);
  expect(JSON.stringify(source)).toBe(before);
}, 40_000);
