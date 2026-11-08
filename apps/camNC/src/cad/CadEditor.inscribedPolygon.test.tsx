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
  fireEvent.change(input, { target: { value: 'Inscribed polygon' } });
  fireEvent.keyDown(input, { key: 'Enter' });
}
function move(x: number, y: number) {
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  const p = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
  fireEvent.pointerMove(canvas, { clientX: p.x, clientY: p.y, pointerId: 1 });
}
it('locks the inscribed circle, accepts sides, offers its diameter, and supports undo/redo', async () => {
  const { canvas, latest } = await setup();
  await choose();
  click(80, 80);
  move(120, 80);
  expect(canvas.querySelector('[data-sketch-tool-preview="inscribedPolygon"] polygon')).toBeTruthy();
  click(120, 80);
  expect(latest().entities.filter(e => e.type === 'line')).toHaveLength(0);
  const sides = screen.getByRole('spinbutton', { name: 'Polygon sides' });
  expect(document.activeElement).toBe(sides);
  fireEvent.change(sides, { target: { value: '5' } });
  await userEvent.click(screen.getByRole('button', { name: 'Create polygon' }));
  await checked();
  expect(latest().entities.filter(e => e.type === 'line')).toHaveLength(5);
  expect(latest().constraints.filter(c => c.type === 'regularPolygon')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Regular polygon constraint' })).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: /Polygon diameter: 80 mm/ }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Polygon diameter value' }), { target: { value: '100' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply polygon diameter' }));
  await checked();
  expect(latest().entities.find(e => e.type === 'circle')!.radius).toBeCloseTo(50);
  key('z', { ctrlKey: true });
  await checked();
  key('z', { ctrlKey: true });
  await checked();
  expect(latest().entities.filter(e => e.type === 'line')).toHaveLength(0);
  key('z', { ctrlKey: true, shiftKey: true });
  await checked();
  expect(latest().entities.filter(e => e.type === 'line')).toHaveLength(5);
});
it('adjusts sides by pointer distance without changing the locked circle', async () => {
  const { canvas, latest } = await setup();
  await choose();
  click(80, 80);
  click(120, 80);
  const end = 120 + 24 / Math.abs(canvas.getScreenCTM()!.a);
  move(end, 80);
  expect((screen.getByRole('spinbutton', { name: 'Polygon sides' }) as HTMLInputElement).value).toBe('8');
  expect(Number(canvas.querySelector('[data-sketch-tool-preview="inscribedPolygon"] circle')!.getAttribute('r'))).toBeCloseTo(40);
  click(end, 80);
  await checked();
  expect(latest().entities.filter(e => e.type === 'line')).toHaveLength(8);
  expect(latest().entities.find(e => e.type === 'circle')!.radius).toBeCloseTo(40);
});
it('accepts a typed count before radius placement and cancels an unfinished polygon', async () => {
  const { latest } = await setup();
  await choose();
  key('3');
  expect((screen.getByRole('spinbutton', { name: 'Polygon sides' }) as HTMLInputElement).value).toBe('3');
  click(80, 80);
  click(120, 80);
  await userEvent.keyboard('{Enter}');
  await checked();
  expect(latest().entities.filter(e => e.type === 'line')).toHaveLength(3);
  await choose();
  click(160, 160);
  click(180, 160);
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('spinbutton', { name: 'Polygon sides' })).toBeNull();
  expect(latest().entities.filter(e => e.type === 'line')).toHaveLength(3);
});
it('retains center and side-midpoint snap intent', async () => {
  const { latest } = await setup([
    { x: 80, y: 80 },
    { x: 120, y: 80 },
  ]);
  await choose();
  click(80, 80);
  click(120, 80);
  await userEvent.click(screen.getByRole('button', { name: 'Create polygon' }));
  await checked();
  expect(latest().entities.filter(e => e.type === 'line')).toHaveLength(6);
  expect(latest().constraints.some(c => c.type === 'midpoint')).toBe(true);
  expect(screen.queryByText(/could not|conflict|failed/i)).toBeNull();
});
