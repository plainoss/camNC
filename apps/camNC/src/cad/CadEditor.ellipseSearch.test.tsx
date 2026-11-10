import { createCadDocument, createCadPart, type CadDocument } from '@wbcnc/cad';
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
  fireEvent.change(first, { target: { value: '60' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply primary axis diameter' }));
  await checked();
  await userEvent.click(screen.getByRole('button', { name: /^Secondary axis diameter:/ }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Secondary axis diameter value' }), { target: { value: '40' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply secondary axis diameter' }));
  await checked();
  const ellipse = latest().entities.find(e => e.type === 'ellipse')!;
  expect(ellipse.radius).toBeCloseTo(20, 5);
  expect(ellipse.primaryAxis).toBe('major');
  expect(latest().constraints.flatMap(c => (c.type === 'distance' ? [c.value] : []))).toEqual([60, 40]);
  key('z', { ctrlKey: true });
  await checked();
  key('z', { ctrlKey: true });
  await checked();
  expect(latest().entities.find(e => e.type === 'ellipse')!.primaryAxis).toBe('minor');
  key('z', { ctrlKey: true, shiftKey: true });
  await checked();
  key('z', { ctrlKey: true, shiftKey: true });
  await checked();
  expect(latest().entities.find(e => e.type === 'ellipse')!.primaryAxis).toBe('major');
  expect(latest().constraints.flatMap(c => (c.type === 'distance' ? [c.value] : []))).toEqual([60, 40]);
});
it('light-dismisses search without taking focus from the clicked part-name field', async () => {
  await setup();
  key('c', { altKey: true, code: 'KeyC' });
  const field = screen.getByRole('textbox', { name: 'Part name' });
  await userEvent.click(field, { position: { x: 2, y: 10 } });
  await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
  expect(document.activeElement).toBe(field);
});

it('keeps result focus and highlighted keyboard selection together', async () => {
  await setup();
  key('c', { altKey: true, code: 'KeyC' });
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: 'rectangle' } });
  const corner = screen.getByRole('option', { name: /Corner rectangle/ });
  corner.focus();
  await userEvent.keyboard('{ArrowDown}');
  const center = screen.getByRole('option', { name: /Center rectangle/ });
  expect(document.activeElement).toBe(center);
  expect(center.getAttribute('aria-selected')).toBe('true');
  await userEvent.keyboard('{Enter}');
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.getByRole('button', { name: 'Center rectangle (R)' }).getAttribute('aria-pressed')).toBe('true');
});
