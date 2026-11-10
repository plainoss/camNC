import { addCircle, createPlateDocument, type CadDocument, type CadLineEntity, type CadPointEntity } from '@wbcnc/cad';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from '@wbcnc/cad-editor/session';
const ids: string[] = [];
afterEach(() => {
  cleanup();
  ids.forEach(endCadSession);
  ids.length = 0;
});
const checked = () => waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20000 });
async function setup(circle = false) {
  const doc = createPlateDocument({ width: 120, height: 80 });
  ids.push(doc.id);
  if (circle) doc.parts[0]!.sketch = addCircle(doc.parts[0]!.sketch, { x: 40, y: 40, radius: 8, dimensioned: true });
  const change = vi.fn<(d: CadDocument) => void>();
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={doc} onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  vi.spyOn(canvas, 'setPointerCapture').mockImplementation(() => {});
  await checked();
  return { canvas, doc, latest: () => change.mock.calls.at(-1)?.[0].parts[0]!.sketch ?? doc.parts[0]!.sketch };
}
function pick(canvas: SVGSVGElement, x: number, y: number) {
  const p = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
  const e = { clientX: p.x, clientY: p.y, pointerId: 1, button: 0 };
  fireEvent.pointerDown(canvas, e);
  fireEvent.pointerUp(canvas, e);
}
function choose(canvas: SVGSVGElement) {
  fireEvent.keyDown(canvas, { key: 'c', altKey: true, code: 'KeyC' });
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: 'transform' } });
  fireEvent.keyDown(input, { key: 'Enter' });
}
const value = (name: string, text: string) => fireEvent.change(screen.getByLabelText(name), { target: { value: text } });
it('previews numeric translation/rotation/scale from preselection and applies one undoable transform', async () => {
  const { canvas, doc, latest } = await setup();
  fireEvent.keyDown(canvas, { key: 'a', ctrlKey: true });
  choose(canvas);
  expect(screen.getByRole('button', { name: /Finish sketch/ })).toBeDisabled();
  value('Translate X', '100');
  value('Translate Y', '50');
  value('Rotate angle', '90');
  value('Scale factor', '2');
  expect(screen.getByText('240', { exact: true })).toBeVisible();
  expect(screen.getByText('160', { exact: true })).toBeVisible();
  expect(latest()).toEqual(doc.parts[0]!.sketch);
  fireEvent.click(screen.getByRole('button', { name: 'Apply transform' }));
  await checked();
  const edge = latest().entities.find(e => e.type === 'line' && !e.construction) as CadLineEntity;
  const p = latest().entities.find(e => e.id === edge.startId) as CadPointEntity;
  expect(p.x).toBeCloseTo(240, 5);
  expect(p.y).toBeCloseTo(-30, 5);
  fireEvent.click(screen.getByRole('button', { name: /^Undo/ }));
  await checked();
  expect(latest().entities.find(e => e.id === edge.startId)).toEqual(doc.parts[0]!.sketch.entities.find(e => e.id === edge.startId));
  fireEvent.click(screen.getByRole('button', { name: /^Redo/ }));
  await checked();
  expect((latest().entities.find(e => e.id === edge.startId) as CadPointEntity).x).toBeCloseTo(240, 5);
});
it('supports armed selection, independent copied holes, invalid scale correction and cancellation', async () => {
  const { canvas, latest } = await setup(true);
  choose(canvas);
  pick(canvas, 48, 40);
  value('Translate X', '40');
  value('Scale factor', '-1');
  expect(screen.getByRole('button', { name: 'Apply transform' })).toBeDisabled();
  value('Scale factor', '1.25');
  fireEvent.click(screen.getByLabelText('Copy selection'));
  expect(latest().entities.filter(e => e.type === 'circle')).toHaveLength(1);
  pick(canvas, 100, 70);
  await checked();
  const circles = latest().entities.filter(e => e.type === 'circle');
  expect(circles).toHaveLength(2);
  expect(circles.map(e => e.radius)).toEqual([8, 10]);
  choose(canvas);
  value('Translate Y', '10');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel transform' }));
  expect(
    latest()
      .entities.filter(e => e.type === 'circle')
      .map(e => e.radius)
  ).toEqual([8, 10]);
});
it('drags all four manipulators from an immutable baseline and moves the pivot without changing the preview geometry', async () => {
  const { canvas, latest } = await setup(true);
  pick(canvas, 48, 40);
  choose(canvas);
  const drag = (kind: string, move: (x: number, y: number) => { x: number; y: number }) => {
    const handle = canvas.querySelector(`[data-transform-handle="${kind}"]`)!;
    const box = handle.getBoundingClientRect(),
      x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    const to = move(x, y),
      e = { pointerId: 2, button: 0 };
    fireEvent.pointerDown(handle, { ...e, clientX: x, clientY: y });
    fireEvent.pointerMove(canvas, { ...e, clientX: to.x, clientY: to.y });
    fireEvent.pointerUp(canvas, e);
  };
  const unit = canvas.getScreenCTM()!.a;
  drag('translate', (x, y) => ({ x: x + 20 * unit, y: y - 10 * unit }));
  expect(Number((screen.getByLabelText('Translate X') as HTMLInputElement).value)).toBeCloseTo(20, 5);
  expect(Number((screen.getByLabelText('Translate Y') as HTMLInputElement).value)).toBeCloseTo(10, 5);
  const center = () => {
    const b = canvas.querySelector('[data-transform-handle="pivot"]')!.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  let c = center();
  drag('rotate', () => ({ x: c.x + 60, y: c.y }));
  expect(Number((screen.getByLabelText('Rotate angle') as HTMLInputElement).value)).toBeCloseTo(-90, 4);
  c = center();
  drag('scale', (x, y) => ({ x: c.x + 2 * (x - c.x), y: c.y + 2 * (y - c.y) }));
  expect(Number((screen.getByLabelText('Scale factor') as HTMLInputElement).value)).toBeCloseTo(2, 5);
  const circle = latest().entities.find(e => e.type === 'circle')!;
  const attrs = () => {
    const shape = canvas.querySelector(`[data-entity-id="${circle.id}"] circle`)!;
    return ['cx', 'cy', 'r'].map(name => Number(shape.getAttribute(name)));
  };
  const before = attrs(),
    oldCenter = center();
  drag('pivot', (x, y) => ({ x: x + 15 * unit, y: y + 5 * unit }));
  expect(center().x).toBeCloseTo(oldCenter.x + 15 * unit, 3);
  expect(center().y).toBeCloseTo(oldCenter.y + 5 * unit, 3);
  attrs().forEach((n, i) => expect(n).toBeCloseTo(before[i]!, 5));
  drag('pivot', () => ({ x: oldCenter.x + 1, y: oldCenter.y + 1 }));
  expect(center().x).toBeCloseTo(oldCenter.x, 3);
  expect(center().y).toBeCloseTo(oldCenter.y, 3);
  value('Pivot X', '5');
  value('Pivot Y', '-20');
  attrs().forEach((n, i) => expect(n).toBeCloseTo(before[i]!, 5));
  expect(screen.getByRole('button', { name: /^Undo/ })).toBeDisabled();
  fireEvent.keyDown(canvas, { key: 'Escape' });
  expect(latest().entities.find(e => e.id === circle.id)).toEqual(circle);
});

it('accepts an unchanged transform with Enter without adding history', async () => {
  const { canvas, latest, doc } = await setup();
  fireEvent.keyDown(canvas, { key: 'a', ctrlKey: true });
  choose(canvas);
  fireEvent.keyDown(canvas, { key: 'Enter' });
  expect(screen.queryByRole('form', { name: 'Transform selection' })).toBeNull();
  expect(latest()).toEqual(doc.parts[0]!.sketch);
  expect(screen.getByRole('button', { name: /^Undo/ })).toBeDisabled();
});
