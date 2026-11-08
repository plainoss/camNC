import { createPlateDocument, type CadDocument } from '@wbcnc/cad';
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
async function setup() {
  const doc = createPlateDocument({ width: 120, height: 80 });
  ids.push(doc.id);
  const change = vi.fn<(d: CadDocument) => void>();
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={doc} onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  vi.spyOn(canvas, 'setPointerCapture').mockImplementation(() => {});
  await checked();
  return { canvas, latest: () => change.mock.calls.at(-1)?.[0].parts[0]!.sketch ?? doc.parts[0]!.sketch };
}
function pick(canvas: SVGSVGElement, x: number, y: number, shiftKey = false) {
  const p = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
  const event = { clientX: p.x, clientY: p.y, pointerId: 1, button: 0, shiftKey };
  fireEvent.pointerDown(canvas, event);
  fireEvent.pointerUp(canvas, event);
}
async function choose(canvas: SVGSVGElement) {
  fireEvent.keyDown(canvas, { key: 'c', altKey: true, code: 'KeyC' });
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: 'chamfer' } });
  fireEvent.keyDown(input, { key: 'Enter' });
}
it('previews a preselected corner, applies independent setbacks atomically and restores it with undo/redo', async () => {
  const { canvas, latest } = await setup();
  pick(canvas, 120, 0);
  await choose(canvas);
  expect(screen.getByRole('button', { name: 'Apply chamfers' })).toBeEnabled();
  fireEvent.change(screen.getByLabelText('Chamfer distance 1'), { target: { value: '8' } });
  fireEvent.change(screen.getByLabelText('Chamfer distance 2'), { target: { value: '12' } });
  expect(latest().entities.filter(e => e.type === 'line' && !e.construction)).toHaveLength(4);
  fireEvent.click(screen.getByRole('button', { name: 'Apply chamfers' }));
  await checked();
  expect(latest().entities.filter(e => e.type === 'line' && !e.construction)).toHaveLength(5);
  expect(
    latest()
      .constraints.filter(c => 'label' in c && c.label?.startsWith('Chamfer distance'))
      .map(c => 'value' in c && c.value)
  ).toEqual([8, 12]);
  fireEvent.click(screen.getByRole('button', { name: /^Undo/ }));
  await checked();
  expect(latest().entities.filter(e => e.type === 'line' && !e.construction)).toHaveLength(4);
  fireEvent.click(screen.getByRole('button', { name: /^Redo/ }));
  await checked();
  expect(latest().entities.filter(e => e.type === 'line' && !e.construction)).toHaveLength(5);
});
it('supports armed edge selection, invalid-distance feedback, drag adjustment and cancellation without history', async () => {
  const { canvas, latest } = await setup();
  await choose(canvas);
  pick(canvas, 60, 0);
  pick(canvas, 120, 40);
  fireEvent.change(screen.getByLabelText('Chamfer distance 1'), { target: { value: '120' } });
  expect(screen.getByRole('button', { name: 'Apply chamfers' })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('consume an entire adjacent line');
  fireEvent.change(screen.getByLabelText('Chamfer distance 1'), { target: { value: '10' } });
  const handle = canvas.querySelector('[data-chamfer-handle="0"]')!;
  const from = new DOMPoint(110, 0).matrixTransform(canvas.getScreenCTM()!);
  const to = new DOMPoint(105, 0).matrixTransform(canvas.getScreenCTM()!);
  fireEvent.pointerDown(handle, { clientX: from.x, clientY: from.y, pointerId: 2, button: 0 });
  fireEvent.pointerMove(canvas, { clientX: to.x, clientY: to.y, pointerId: 2, button: 0 });
  fireEvent.pointerUp(canvas, { pointerId: 2, button: 0 });
  expect(screen.getByLabelText('Chamfer distance 1')).toHaveValue('15');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel chamfers' }));
  expect(latest().entities.filter(e => e.type === 'line' && !e.construction)).toHaveLength(4);
  expect(latest().constraints.some(c => 'label' in c && c.label?.startsWith('Chamfer'))).toBe(false);
});
