import { createCadDocument, createCadPart, addPoint, type CadDocument } from '@wbcnc/cad';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from '@wbcnc/cad-editor/session';
const ids: string[] = [];
afterEach(() => {
  cleanup();
  ids.forEach(endCadSession);
  ids.length = 0;
});
async function setup(points: { x: number; y: number }[] = []) {
  const doc = createCadDocument();
  doc.parts.push(createCadPart());
  for (const point of points) doc.parts[0]!.sketch = addPoint(doc.parts[0]!.sketch, { ...point, fixed: true });
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
const checked = () => waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20000 });
const key = (key: string, extra = {}) => fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key, ...extra });
function click(x: number, y: number) {
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  const p = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
  fireEvent.pointerDown(canvas, { clientX: p.x, clientY: p.y, button: 0, pointerId: 1 });
}

async function choose() {
  key('c', { altKey: true, code: 'KeyC' });
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: 'Aligned rectangle' } });
  fireEvent.keyDown(input, { key: 'Enter' });
}
it('previews an oriented rectangle, offers aligned sizes and retains topology through undo/redo', async () => {
  const { canvas, latest } = await setup();
  await choose();
  click(40, 40);
  click(70, 80);
  expect(latest().entities.filter(e => e.type === 'line')).toHaveLength(0);
  const p = new DOMPoint(54, -92).matrixTransform(canvas.getScreenCTM()!);
  fireEvent.pointerMove(canvas, { clientX: p.x, clientY: p.y, pointerId: 1 });
  expect(canvas.querySelector('[data-sketch-tool-preview="alignedRectangle"] polygon')).toBeTruthy();
  click(54, 92);
  await checked();
  expect(latest().entities.filter(e => e.type === 'line')).toHaveLength(4);
  expect(screen.getByRole('button', { name: /Rectangle width: 50 mm/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /Rectangle height: 20 mm/ })).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: /Rectangle width:/ }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Rectangle width value' }), { target: { value: '80' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply rectangle width' }));
  await checked();
  await userEvent.click(screen.getByRole('button', { name: /Rectangle height:/ }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Rectangle height value' }), { target: { value: '30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply rectangle height' }));
  await checked();
  expect(latest().constraints.flatMap(c => (c.type === 'distance' ? [c.value] : []))).toEqual([80, 30]);
  key('z', { ctrlKey: true });
  await checked();
  key('z', { ctrlKey: true });
  await checked();
  key('z', { ctrlKey: true });
  await checked();
  expect(latest().entities.filter(e => e.type === 'line')).toHaveLength(0);
  key('z', { ctrlKey: true, shiftKey: true });
  await checked();
  expect(latest().entities.filter(e => e.type === 'line')).toHaveLength(4);
});
it('retains an off-corner third snap on the opposite side supporting line', async () => {
  const { latest } = await setup([
    { x: 40, y: 40 },
    { x: 70, y: 80 },
    { x: 84, y: 132 },
  ]);
  await choose();
  click(40, 40);
  click(70, 80);
  click(84, 132);
  await checked();
  const sketch = latest(),
    top = sketch.entities.filter(e => e.type === 'line')[2]!;
  expect(sketch.entities.filter(e => e.type === 'line')).toHaveLength(4);
  expect(sketch.constraints.some(c => c.type === 'pointOnLine' && c.entityId === top.id)).toBe(true);
  expect(sketch.constraints.filter(c => c.type === 'coincident')).toHaveLength(6);
});
it('keeps invalid extents correctable and cancels partial placement', async () => {
  const { latest } = await setup();
  await choose();
  click(40, 40);
  click(70, 80);
  click(100, 120);
  expect(latest().entities.filter(e => e.type === 'line')).toHaveLength(0);
  expect(screen.getByText(/Choose a nonzero first edge/)).toBeTruthy();
  click(54, 92);
  await checked();
  expect(latest().entities.filter(e => e.type === 'line')).toHaveLength(4);
  await choose();
  click(100, 100);
  key('Escape');
  expect(latest().entities.filter(e => e.type === 'line')).toHaveLength(4);
});

it.each([
  { x: 54, y: 92 },
  { x: 24, y: 52 },
])('snaps a third click at an exact opposite corner without a redundant line relation (%j)', async third => {
  const { latest } = await setup([{ x: 40, y: 40 }, { x: 70, y: 80 }, third]);
  await choose();
  click(40, 40);
  click(70, 80);
  click(third.x, third.y);
  await checked();
  expect(latest().entities.filter(e => e.type === 'line')).toHaveLength(4);
  expect(latest().constraints.filter(c => c.type === 'coincident')).toHaveLength(7);
  expect(latest().constraints.filter(c => c.type === 'pointOnLine')).toHaveLength(0);
});
