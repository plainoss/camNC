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
  fireEvent.change(input, { target: { value: 'Center point arc' } });
  fireEvent.keyDown(input, { key: 'Enter' });
}
function move(x: number, y: number) {
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  const p = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
  fireEvent.pointerMove(canvas, { clientX: p.x, clientY: p.y, pointerId: 1 });
}
const sweep = (arc: { startAngle: number; endAngle: number }) =>
  (((arc.endAngle - arc.startAngle + Math.PI * 2) % (Math.PI * 2)) * 180) / Math.PI;
it('creates a center/start/end arc with radius input and undo/redo', async () => {
  const { canvas, latest } = await setup();
  await choose();
  click(80, 80);
  click(120, 80);
  move(80, 140);
  expect(canvas.querySelector('[data-center-arc-preview]')).toBeTruthy();
  click(80, 140);
  await checked();
  expect(latest().entities.find(e => e.type === 'arc')!.radius).toBeCloseTo(40);
  expect(sweep(latest().entities.find(e => e.type === 'arc')!)).toBeCloseTo(90);
  await userEvent.click(screen.getByRole('button', { name: /Arc radius: 40 mm/ }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Arc radius value' }), { target: { value: '50' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply arc radius' }));
  await checked();
  expect(latest().entities.find(e => e.type === 'arc')!.radius).toBeCloseTo(50);
  key('z', { ctrlKey: true });
  await checked();
  key('z', { ctrlKey: true });
  await checked();
  expect(latest().entities.filter(e => e.type === 'arc')).toHaveLength(0);
  key('z', { ctrlKey: true, shiftKey: true });
  await checked();
  expect(latest().entities.filter(e => e.type === 'arc')).toHaveLength(1);
});
it.each([1, -1])('tracks major sweep in direction %s across wraparound', async direction => {
  const { latest } = await setup();
  await choose();
  click(80, 80);
  click(120, 80);
  move(80, 80 + 40 * direction);
  move(40, 80);
  move(80, 80 - 40 * direction);
  click(80, 80 - 40 * direction);
  await checked();
  expect(sweep(latest().entities.find(e => e.type === 'arc')!)).toBeCloseTo(270);
});
it.each([120, 40])('preserves center/start snaps and exact endpoint y=%s', async y => {
  const { latest } = await setup([
    { x: 80, y: 80 },
    { x: 120, y: 80 },
    { x: 80, y },
  ]);
  await choose();
  click(80, 80);
  click(120, 80);
  click(80, y);
  await checked();
  expect(latest().entities.find(e => e.type === 'arc')!.radius).toBeCloseTo(40);
  expect(screen.queryByText(/could not|conflict|failed/i)).toBeNull();
});
it('rejects a zero sweep, permits correction, and cancels partial geometry', async () => {
  const { latest } = await setup();
  await choose();
  click(80, 80);
  click(120, 80);
  click(140, 80);
  expect(latest().entities.filter(e => e.type === 'arc')).toHaveLength(0);
  expect(screen.getByText(/Choose a nonzero radius/)).toBeTruthy();
  click(80, 120);
  await checked();
  expect(latest().entities.filter(e => e.type === 'arc')).toHaveLength(1);
  await choose();
  click(160, 160);
  key('Escape');
  expect(latest().entities.filter(e => e.type === 'arc')).toHaveLength(1);
});

it('projects an off-radius snap target without attaching an incompatible endpoint relation', async () => {
  const { latest } = await setup([
    { x: 80, y: 80 },
    { x: 120, y: 80 },
    { x: 80, y: 140 },
  ]);
  await choose();
  click(80, 80);
  click(120, 80);
  click(80, 140);
  await checked();
  const sketch = latest(),
    arc = sketch.entities.find(e => e.type === 'arc')!;
  expect(arc.radius).toBeCloseTo(40);
  const points = sketch.entities.filter(e => e.type === 'point');
  const ends = points.filter(e => e.id === arc.startId || e.id === arc.endId);
  expect(ends.some(p => Math.abs(p.x - 80) < 1e-6 && Math.abs(p.y - 120) < 1e-6)).toBe(true);
  expect(sketch.constraints.some(c => c.type === 'coincident' && ends.some(e => [c.pointAId, c.pointBId].includes(e.id)))).toBe(false);
  expect(screen.queryByText(/could not|conflict|failed/i)).toBeNull();
});
