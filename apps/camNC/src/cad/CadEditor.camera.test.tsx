import { addLine, createCadDocument, createCadPart, createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { ModelViewport } from '@/cam/model/ModelViewport';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { settled } from '@/test/settled';

vi.mock('@/cam/model/ModelViewport', { spy: true });
const viewportCamera = () => vi.mocked(ModelViewport).mock.calls.findLast(([props]) => props.cameraState)?.[0].cameraState;
/**
 * The workspace view is loaded lazily, and the settled signal can't see its module loading before its canvas is
 * there: wait for the camera it publishes, then settle on its frames and Html's separate DOM root (the origin marker).
 */
async function viewportReady() {
  await waitFor(() => expect(viewportCamera()?.current?.height).toBeGreaterThan(0), { timeout: 20_000 });
  await settled();
  return viewportCamera()!;
}
const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});

it.each([1200, 375, 320])(
  'keeps the same screen positions through opening, drawing in and closing an oblique front-plane sketch at %dpx',
  async width => {
    const source = createPlateDocument({ width: 57, height: 78, thickness: 25 });
    source.parts[0]!.drawnOn = { on: { plane: 'front' }, offset: 0 };
    sessions.push(source.id);
    render(
      <div style={{ width, height: 700, display: 'flex' }}>
        <CadEditor document={source} startIn3D onDraftChange={() => {}} onFinish={() => {}} onCancel={() => {}} />
      </div>
    );
    const state = await viewportReady();
    expect(screen.getByTestId('model-origin')).toBeVisible();
    const marker = () => {
      const box = screen.getByTestId('model-origin').getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    };
    const before = marker();
    const saved = structuredClone(state.current!);
    await userEvent.dblClick(within(screen.getByRole('region', { name: 'Features' })).getByRole('button', { name: /^Sketch ·/ }));
    await settled();
    const drawing = screen.getByTestId('cad-drawing');
    const point = new DOMPoint(0, 0).matrixTransform((drawing as unknown as SVGGraphicsElement).getScreenCTM()!);
    expect(point.x).toBeCloseTo(before.x, 0);
    expect(point.y).toBeCloseTo(before.y, 0);
    expect(screen.getByTestId('cad-canvas').hasAttribute('data-sketch-turned')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: '✓ Finish sketch' }));
    await settled();
    expect(marker().x).toBeCloseTo(before.x, 0);
    expect(marker().y).toBeCloseTo(before.y, 0);
    expect(state.current!.height).toBeCloseTo(saved.height, 6);
    state.current!.back.forEach((value, axis) => expect(value).toBeCloseTo(saved.back[axis]!, 10));
  }
);

it('shows the parts built before a sketch behind it, without changing view, looking normal only when asked and turning by a right drag, and none of its own', async () => {
  const side = { ...createPlateDocument({ width: 130, height: 500, thickness: 20 }).parts[0]!, name: 'Side' };
  side.drawnOn = { on: { plane: 'right' as const }, offset: 0 };
  const back = { ...createCadPart('Back', 4), drawnOn: { on: { partId: side.id, face: 'top' as const }, offset: -10 } };
  back.sketch = addLine(back.sketch, { x1: 10, y1: 0, x2: 10, y2: 500 });
  const source: CadDocument = { ...createCadDocument(), parts: [side, { ...back, thin: { depth: 380, midPlane: true } }] };
  sessions.push(source.id);
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={() => {}} onFinish={async () => {}} onCancel={() => {}} />
    </div>
  );
  // The sketch must inherit a rendered camera.
  await viewportReady();
  const features = screen.getByRole('region', { name: 'Features' });
  expect(document.querySelector('.cad-sketch-backdrop')).toBeNull();
  await userEvent.dblClick(within(features).getByRole('button', { name: /Sketch · Back/ }));
  await screen.findByRole('dialog', { name: 'Sketch · Back' });
  // The backdrop is loaded lazily too, so its canvas is waited for before it can count as a view still to draw.
  await waitFor(() => expect(document.querySelector('.cad-sketch-backdrop canvas')).not.toBeNull(), { timeout: 10_000 });
  await settled();
  // The drawing stays on top, and the face it's drawn on shows by its outline over the part.
  const canvas = screen.getByTestId('cad-canvas');
  expect(canvas.classList.contains('cad-canvas-over-parts')).toBe(true);
  // A right drag turns the view, drawing and parts together; the camera never turns by itself.
  expect(canvas.hasAttribute('data-sketch-turned')).toBe(true);
  canvas.focus();
  await userEvent.keyboard('n');
  await settled();
  expect(canvas.hasAttribute('data-sketch-turned')).toBe(false);
  const box = canvas.getBoundingClientRect(),
    at = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  const pointer = (type: string, dx: number, buttons: number) =>
    canvas.dispatchEvent(
      new PointerEvent(type, { bubbles: true, clientX: at.x + dx, clientY: at.y, button: 2, buttons, pointerId: 1, pointerType: 'mouse' })
    );
  pointer('pointerdown', 0, 2);
  for (const dx of [20, 40, 60]) pointer('pointermove', dx, 2);
  pointer('pointerup', 60, 0);
  await settled();
  expect(canvas.hasAttribute('data-sketch-turned')).toBe(true);
  // The drawing turns inside the canvas, so its lines keep their width.
  expect(screen.getByTestId('cad-drawing').getAttribute('transform')).toMatch(/matrix\(/);
  expect(canvas.style.transform).toBe('');
  expect(screen.queryByRole('menu')).toBeNull();
  // n looks straight at the plane again, and once more, at its other side.
  canvas.focus();
  await userEvent.keyboard('n');
  await settled();
  expect(canvas.hasAttribute('data-sketch-turned')).toBe(false);
  await userEvent.keyboard('n');
  await settled();
  expect(screen.getByTestId('cad-drawing').getAttribute('transform')).toMatch(/matrix\(-1 0 0 1 0 0\)/);
  // Seen from behind, a middle drag to the right still carries the drawing to the right.
  const viewX = () => Number(canvas.getAttribute('viewBox')!.split(' ')[0]);
  const x0 = viewX();
  const middle = (type: string, dx: number, buttons: number) =>
    canvas.dispatchEvent(
      new PointerEvent(type, { bubbles: true, clientX: at.x + dx, clientY: at.y, button: 1, buttons, pointerId: 1, pointerType: 'mouse' })
    );
  middle('pointerdown', 0, 4);
  middle('pointermove', 50, 4);
  middle('pointerup', 50, 0);
  await settled();
  expect(viewX()).toBeGreaterThan(x0);
  await userEvent.click(within(screen.getByRole('dialog', { name: 'Sketch · Back' })).getByRole('button', { name: 'Cancel' }));
  await settled();
  expect(document.querySelector('.cad-sketch-backdrop')).toBeNull();
});
