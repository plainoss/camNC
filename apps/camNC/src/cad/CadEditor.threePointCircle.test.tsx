import { createCadDocument, createCadPart, addPoint, type CadDocument } from '@wbcnc/cad';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from './session';
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
  fireEvent.change(input, { target: { value: '3 point circle' } });
  fireEvent.keyDown(input, { key: 'Enter' });
}
it('previews three rim points, supports diameter entry, undo/redo, and cancels partial placement', async () => {
  const { canvas, latest } = await setup();
  await choose();
  click(70, 50);
  click(50, 70);
  expect(latest().entities.filter(e => e.type === 'circle')).toHaveLength(0);
  const p = new DOMPoint(30, -50).matrixTransform(canvas.getScreenCTM()!);
  fireEvent.pointerMove(canvas, { clientX: p.x, clientY: p.y, pointerId: 1 });
  expect(canvas.querySelector('[data-sketch-tool-preview="threePointCircle"] circle')).toBeTruthy();
  click(30, 50);
  await checked();
  expect(latest().entities.find(e => e.type === 'circle')!.radius).toBeCloseTo(20);
  expect(screen.getByText('Click three points along the circle circumference.')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: /Circle diameter: 40 mm/ }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Circle diameter value' }), { target: { value: '50' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply circle diameter' }));
  await checked();
  expect(latest().entities.find(e => e.type === 'circle')!.radius).toBeCloseTo(25);
  key('z', { ctrlKey: true });
  await checked();
  expect(latest().entities.find(e => e.type === 'circle')!.radius).toBeCloseTo(20);
  key('z', { ctrlKey: true });
  await checked();
  expect(latest().entities.filter(e => e.type === 'circle')).toHaveLength(0);
  key('z', { ctrlKey: true, shiftKey: true });
  await checked();
  expect(latest().entities.filter(e => e.type === 'circle')).toHaveLength(1);
  await choose();
  click(100, 100);
  key('Escape');
  click(120, 100);
  expect(latest().entities.filter(e => e.type === 'circle')).toHaveLength(1);
});
it('rejects a collinear third click and lets the user correct it', async () => {
  const { latest } = await setup();
  await choose();
  click(30, 30);
  click(50, 30);
  click(70, 30);
  expect(latest().entities.filter(e => e.type === 'circle')).toHaveLength(0);
  expect(screen.getByText(/three distinct circle points/)).toBeTruthy();
  click(50, 50);
  await checked();
  expect(latest().entities.find(e => e.type === 'circle')!.radius).toBeCloseTo(Math.sqrt(200));
});
it('retains all three snapped rim relations rather than snapping the circle center', async () => {
  const points = [
    { x: 70, y: 50 },
    { x: 50, y: 70 },
    { x: 30, y: 50 },
  ];
  const { latest } = await setup(points);
  await choose();
  for (const p of points) click(p.x, p.y);
  await checked();
  const sketch = latest(),
    circle = sketch.entities.find(e => e.type === 'circle')!;
  expect(circle.radius).toBeCloseTo(20);
  expect(sketch.constraints.filter(c => c.type === 'pointOnCircle' && c.entityId === circle.id)).toHaveLength(3);
  const center = sketch.entities.find(e => e.id === circle.centerId)!;
  expect(center.type === 'point' && center.x).toBeCloseTo(50);
  expect(center.type === 'point' && center.y).toBeCloseTo(50);
});
