import { createCadDocument, createCadPart, type CadDocument } from '@wbcnc/cad';
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
async function setup() {
  const doc = createCadDocument();
  doc.parts.push(createCadPart());
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
it('opens with Option+C even when macOS supplies ç, searches, activates, and restores canvas focus', async () => {
  const { canvas } = await setup();
  key('ç', { altKey: true, code: 'KeyC' });
  const input = screen.getByRole('combobox', { name: 'Search tools' });
  expect(document.activeElement).toBe(input);
  expect(screen.getByText('Start typing to search tools')).toBeTruthy();
  fireEvent.change(input, { target: { value: 'ELLIPSE' } });
  expect(screen.getByRole('option', { name: 'Ellipse' })).toBeTruthy();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(document.activeElement).toBe(canvas);
  expect(screen.getByRole('button', { name: 'Ellipse' }).getAttribute('aria-pressed')).toBe('true');
});
it('creates an ellipse after three clicks, offers both diameters, and supports undo/redo', async () => {
  const { canvas, latest } = await setup();
  key('c', { altKey: true, code: 'KeyC' });
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: 'ellipse' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  click(40, 40);
  click(80, 40);
  expect(latest().entities.filter(e => e.type === 'ellipse')).toHaveLength(0);
  fireEvent.pointerMove(canvas, { clientX: 100, clientY: 200, pointerId: 1 });
  expect(canvas.querySelector('[data-sketch-tool-preview="ellipse"]')).not.toBeNull();
  click(40, 60);
  await checked();
  expect(latest().entities.filter(e => e.type === 'ellipse')).toHaveLength(1);
  expect(screen.getByRole('button', { name: /Primary axis diameter: 80 mm/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /Secondary axis diameter: 40 mm/ })).toBeTruthy();
  key('z', { ctrlKey: true });
  expect(latest().entities.filter(e => e.type === 'ellipse')).toHaveLength(0);
  key('z', { ctrlKey: true, shiftKey: true });
  await checked();
  expect(latest().entities.filter(e => e.type === 'ellipse')).toHaveLength(1);
});
it('searches constraints and closes with Escape without changing the active drawing tool', async () => {
  const { canvas } = await setup();
  key('l');
  await userEvent.click(screen.getByRole('button', { name: /Search tools/ }));
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: 'tangent' } });
  expect(screen.getByRole('option', { name: 'Tangent' })).toBeTruthy();
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
  expect(document.activeElement).toBe(canvas);
  expect(screen.getByRole('button', { name: 'Line (L)' }).getAttribute('aria-pressed')).toBe('true');
});
it('accepts primary then secondary diameters when the first placed axis is smaller', async () => {
  const { latest } = await setup();
  key('c', { altKey: true, code: 'KeyC' });
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: 'ellipse' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  click(50, 50);
  click(60, 50);
  click(50, 70);
  await checked();
  await userEvent.click(screen.getByRole('button', { name: /Primary axis diameter: 20 mm/ }));
  const first = screen.getByRole('textbox', { name: 'Primary axis diameter value' });
  fireEvent.change(first, { target: { value: '30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply primary axis diameter' }));
  await checked();
  await userEvent.click(screen.getByRole('button', { name: /^Secondary axis diameter:/ }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Secondary axis diameter value' }), { target: { value: '70' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply secondary axis diameter' }));
  await checked();
  const ellipse = latest().entities.find(e => e.type === 'ellipse')!;
  expect(ellipse.radius).toBeCloseTo(15, 5);
  expect(
    latest()
      .constraints.filter(c => c.type === 'distance')
      .map(c => c.value)
  ).toEqual([30, 70]);
});
