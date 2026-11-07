import { createCadDocument, createCadPart, addPoint, addCircle, type CadDocument } from '@wbcnc/cad';
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
async function setup(points: { x: number; y: number }[] = []) {
  const doc = createCadDocument();
  doc.parts.push(createCadPart());
  for (const point of points) doc.parts[0]!.sketch = addPoint(doc.parts[0]!.sketch, { ...point, fixed: true });
  for (const circle of [
    { x: 70, y: 70, radius: 20 },
    { x: 150, y: 100, radius: 30 },
    { x: 230, y: 70, radius: 15 },
  ])
    doc.parts[0]!.sketch = addCircle(doc.parts[0]!.sketch, circle);
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

function pick(x: number, y: number, shiftKey = false) {
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  const p = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
  const event = { clientX: p.x, clientY: p.y, pointerId: 1, button: 0, shiftKey };
  fireEvent.pointerDown(canvas, event);
  fireEvent.pointerUp(canvas, event);
}
async function choose() {
  key('c', { altKey: true, code: 'KeyC' });
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: 'Concentric' } });
  fireEvent.keyDown(input, { key: 'Enter' });
}
it('constrains preselected circles in one undoable batch', async () => {
  const { latest } = await setup();
  pick(90, 70);
  pick(180, 100, true);
  pick(245, 70, true);
  await choose();
  await checked();
  expect(latest().constraints.filter(c => c.label === 'Concentric')).toHaveLength(2);
  const centers = latest()
    .entities.filter(e => e.type === 'circle')
    .map(c => latest().entities.find(e => e.id === c.centerId)!);
  expect(centers[0]!.type === 'point' && centers[0]!.x).toBeCloseTo(centers[1]!.type === 'point' ? centers[1]!.x : NaN);
  key('z', { ctrlKey: true });
  await checked();
  expect(latest().constraints.filter(c => c.label === 'Concentric')).toHaveLength(0);
  key('z', { ctrlKey: true, shiftKey: true });
  await checked();
  expect(latest().constraints.filter(c => c.label === 'Concentric')).toHaveLength(2);
});
it('arms from Shift+O and applies the relationship after two curve picks', async () => {
  const { latest } = await setup();
  key('O', { shiftKey: true });
  pick(90, 70);
  pick(180, 100);
  await checked();
  expect(latest().constraints.filter(c => c.label === 'Concentric')).toHaveLength(1);
  key('Escape');
  expect(screen.getByRole('button', { name: 'Select (Esc)' }).getAttribute('aria-pressed')).toBe('true');
});
