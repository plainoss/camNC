import { addPoint, createCadDocument, createCadPart, type CadDocument } from '@wbcnc/cad';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  for (const point of [
    { x: 60, y: 60 },
    { x: 160, y: 90 },
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
  await waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20000 });
  return { latest: () => change.mock.calls.at(-1)?.[0].parts[0]!.sketch ?? doc.parts[0]!.sketch };
}
const key = (key: string, extra = {}) => fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key, ...extra });
function pick(x: number, y: number) {
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  const p = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
  const event = { clientX: p.x, clientY: p.y, pointerId: 1, button: 0 };
  fireEvent.pointerDown(canvas, event);
  fireEvent.pointerUp(canvas, event);
}
const constraints = () => screen.getByRole('button', { name: 'Constraints' });
const fixedAt = (sketch: ReturnType<Awaited<ReturnType<typeof setup>>['latest']>, x: number) =>
  sketch.entities.some(e => e.type === 'point' && e.x === x && e.fixed);

it('starts Fix with nothing selected, fixes each point clicked, and stays on until Escape', async () => {
  const { latest } = await setup();
  key('J', { shiftKey: true });
  expect(constraints().getAttribute('aria-pressed')).toBe('true');
  pick(60, 60);
  await waitFor(() => expect(fixedAt(latest(), 60)).toBe(true));
  pick(160, 90);
  await waitFor(() => expect(fixedAt(latest(), 160)).toBe(true));
  expect(constraints().getAttribute('aria-pressed')).toBe('true');
  // A second click on a fixed point unfixes it.
  pick(60, 60);
  await waitFor(() => expect(fixedAt(latest(), 60)).toBe(false));
  key('Escape');
  expect(constraints().getAttribute('aria-pressed')).toBe('false');
});

it('never starts the unshifted tool for Shift+K, Shift+G or Shift+U', async () => {
  await setup();
  for (const [letter, name] of [
    ['K', 'Normal'],
    ['G', 'Pierce'],
    ['U', 'Equal curvature'],
  ] as const) {
    key(letter, { shiftKey: true });
    expect(screen.getByText(`The ${name} constraint isn’t available yet.`)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Select (Esc)' }).getAttribute('aria-pressed')).toBe('true');
  }
  key('g');
  expect(screen.getByRole('button', { name: 'Select (Esc)' }).getAttribute('aria-pressed')).toBe('false');
});

it('lists the sketch shortcuts on ?, and closes the list with Escape', async () => {
  await setup();
  key('?', { shiftKey: true });
  const list = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
  const tools = within(list).getByRole('region', { name: 'Sketch tools' });
  expect(within(tools).getByText('Corner rectangle')).toBeDefined();
  expect(within(tools).getByText('G')).toBeDefined();
  expect(within(within(list).getByRole('region', { name: 'Constraints' })).getByText('Shift+J')).toBeDefined();
  fireEvent.keyDown(list, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull());
  expect(screen.getByRole('button', { name: 'Select (Esc)' }).getAttribute('aria-pressed')).toBe('true');
});
