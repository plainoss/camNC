import { createCadDocument, createCadPart, addPoint, addLine, type CadDocument } from '@wbcnc/cad';
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
async function setup(points: { x: number; y: number }[] = []) {
  const doc = createCadDocument();
  doc.parts.push(createCadPart());
  for (const point of points) doc.parts[0]!.sketch = addPoint(doc.parts[0]!.sketch, { ...point, fixed: true });
  doc.parts[0]!.sketch = addLine(doc.parts[0]!.sketch, { x1: 100, y1: 20, x2: 100, y2: 180, construction: true });
  const axis = doc.parts[0]!.sketch.entities.at(-1)!;
  const axisIds = axis.type === 'line' ? [axis.startId, axis.endId] : [];
  doc.parts[0]!.sketch.entities = doc.parts[0]!.sketch.entities.map(e =>
    e.type === 'point' && axisIds.includes(e.id) ? { ...e, fixed: true } : e
  );
  for (const point of [
    { x: 60, y: 60 },
    { x: 150, y: 80 },
    { x: 60, y: 130 },
    { x: 150, y: 150 },
  ])
    doc.parts[0]!.sketch = addPoint(doc.parts[0]!.sketch, point);
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
  fireEvent.change(input, { target: { value: 'Symmetric' } });
  fireEvent.keyDown(input, { key: 'Enter' });
}
it('applies axis-first preselection through tool search and retains undo/redo', async () => {
  const { latest } = await setup();
  pick(100, 100);
  pick(60, 60, true);
  pick(150, 80, true);
  await choose();
  await checked();
  expect(latest().constraints.filter(c => c.type === 'symmetricPoints')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Symmetric constraint' })).toBeTruthy();
  key('z', { ctrlKey: true });
  await checked();
  expect(latest().constraints.filter(c => c.type === 'symmetricPoints')).toHaveLength(0);
  key('z', { ctrlKey: true, shiftKey: true });
  await checked();
  expect(latest().constraints.filter(c => c.type === 'symmetricPoints')).toHaveLength(1);
});
it('arms with Shift+Q, retains the selected axis for successive pairs, and leaves Q for construction', async () => {
  const { latest } = await setup();
  key('Q', { shiftKey: true });
  pick(100, 100);
  pick(60, 60);
  pick(150, 80);
  await checked();
  expect(latest().constraints.filter(c => c.type === 'symmetricPoints')).toHaveLength(1);
  pick(60, 130);
  pick(150, 150);
  await checked();
  expect(latest().constraints.filter(c => c.type === 'symmetricPoints')).toHaveLength(2);
  key('Escape');
  expect(screen.getByRole('button', { name: 'Select (Esc)' }).getAttribute('aria-pressed')).toBe('true');
  key('q');
  expect(screen.getByRole('button', { name: 'Construction Q' }).getAttribute('aria-pressed')).toBe('true');
});
