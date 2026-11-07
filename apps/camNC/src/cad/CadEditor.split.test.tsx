import { addEllipse, addCircle, createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from './session';
const ids: string[] = [];
afterEach(() => {
  cleanup();
  ids.forEach(endCadSession);
  ids.length = 0;
});
const checked = () => waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20000 });
async function setup(ellipse = false) {
  const doc = createPlateDocument({ width: 120, height: 80 });
  ids.push(doc.id);
  doc.parts[0]!.sketch = ellipse
    ? addEllipse(doc.parts[0]!.sketch, { center: { x: 60, y: 40 }, axis: { x: 80, y: 40 }, through: { x: 60, y: 50 } })
    : addCircle(doc.parts[0]!.sketch, { x: 60, y: 40, radius: 15, dimensioned: true });
  if (ellipse) {
    const curve = doc.parts[0]!.sketch.entities.find(e => e.type === 'ellipse')!;
    doc.parts[0]!.sketch.entities = doc.parts[0]!.sketch.entities.map(e => (e.id === curve.centerId ? { ...e, fixed: true } : e));
  }
  const change = vi.fn<(d: CadDocument) => void>();
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={doc} onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  vi.spyOn(canvas, 'setPointerCapture').mockImplementation(() => {});
  await checked();
  fireEvent.keyDown(canvas, { key: 'c', altKey: true, code: 'KeyC' });
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: 'split' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  return { canvas, latest: () => change.mock.calls.at(-1)?.[0].parts[0]!.sketch ?? doc.parts[0]!.sketch };
}
function pick(canvas: SVGSVGElement, x: number, y: number) {
  const p = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
  const e = { clientX: p.x, clientY: p.y, pointerId: 1, button: 0 };
  fireEvent.pointerDown(canvas, e);
  fireEvent.pointerUp(canvas, e);
}
it('splits an open edge once and preserves its outer dimensions and atomic undo/redo', async () => {
  const { canvas, latest } = await setup();
  pick(canvas, 48, 0);
  await checked();
  expect(latest().entities.filter(e => e.type === 'line' && !e.construction)).toHaveLength(5);
  expect(screen.getByText(/Curve split. Click another curve/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^Undo/ }));
  await checked();
  expect(latest().entities.filter(e => e.type === 'line' && !e.construction)).toHaveLength(4);
  fireEvent.click(screen.getByRole('button', { name: /^Redo/ }));
  await checked();
  expect(latest().entities.filter(e => e.type === 'line' && !e.construction)).toHaveLength(5);
});
it('stages two closed-curve points without history, rejects duplicates, cancels and then commits both arcs once', async () => {
  const { canvas, latest } = await setup();
  pick(canvas, 75, 40);
  expect(canvas.querySelector('[data-split-first]')).toBeTruthy();
  expect(latest().entities.some(e => e.type === 'circle')).toBe(true);
  expect(screen.getByRole('button', { name: /^Undo/ })).toBeDisabled();
  expect(screen.getByRole('button', { name: /Finish sketch/ })).toBeDisabled();
  pick(canvas, 75, 40);
  expect(screen.getByText(/Choose a location away from existing endpoints/)).toBeTruthy();
  fireEvent.keyDown(canvas, { key: 'Escape' });
  expect(canvas.querySelector('[data-split-first]')).toBeNull();
  expect(screen.getByRole('button', { name: /^Undo/ })).toBeDisabled();
  fireEvent.keyDown(canvas, { key: 'c', altKey: true, code: 'KeyC' });
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: 'split' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  pick(canvas, 75, 40);
  expect(canvas.querySelector('[data-split-first]')).toBeTruthy();
  pick(canvas, 60, 55);
  await checked();
  expect(latest().entities.filter(e => e.type === 'arc')).toHaveLength(2);
  expect(latest().entities.some(e => e.type === 'circle')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: /^Undo/ }));
  await checked();
  expect(latest().entities.some(e => e.type === 'circle')).toBe(true);
  expect(latest().entities.some(e => e.type === 'arc')).toBe(false);
});

it('shows an explicit release notice when an ellipse becomes exact independent rational segments', async () => {
  const { canvas, latest } = await setup(true);
  pick(canvas, 80, 40);
  pick(canvas, 60, 50);
  await checked();
  expect(latest().entities.filter(e => e.type === 'spline')).toHaveLength(2);
  expect(latest().entities.some(e => e.type === 'ellipse')).toBe(false);
  expect(screen.getByText(/Released relations: 0; released fixed control points: 1/)).toBeVisible();
});
