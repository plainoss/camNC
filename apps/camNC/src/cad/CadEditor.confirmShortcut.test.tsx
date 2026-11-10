import { createCadDocument, createCadPart, createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});

const settled = () =>
  waitFor(() => expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false'), { timeout: 20_000 });

async function openSketch(source = createPlateDocument({ width: 120, height: 80, thickness: 18 })) {
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  const finish = vi.fn();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D={false} onDraftChange={change} onFinish={finish} onCancel={() => {}} />
    </div>
  );
  const dialog = await screen.findByRole('dialog', { name: /^Sketch · / });
  await settled();
  // Initial geometric validation also gates confirmation, independently of the editor's busy attribute.
  await waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20_000 });
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  canvas.focus();
  return { source, dialog, canvas, finish, latest: () => change.mock.calls.at(-1)?.[0] ?? source };
}

const confirmKeys = '{Control>}{Enter}{/Control}';

it.each([
  ['Ctrl', confirmKeys],
  ['Meta', '{Meta>}{Enter}{/Meta}'],
])(
  'confirms a studio sketch with %s+Enter, retains it and returns the keyboard for Extrude',
  async (_name, keys) => {
    const { dialog, latest, finish } = await openSketch();
    const sketch = structuredClone(latest().parts[0]!.sketch);
    const confirm = within(dialog).getByRole('button', { name: /Finish sketch/ });
    await waitFor(() => expect(confirm).toHaveProperty('disabled', false));
    expect(confirm).toHaveAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter');
    await userEvent.keyboard(keys);
    await screen.findByRole('toolbar', { name: 'Part Studio toolbar' });
    expect(screen.queryByRole('dialog', { name: /^Sketch · / })).toBeNull();
    expect(latest().parts[0]!.sketch).toEqual(sketch);
    expect(finish).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('workspace-3d')));
    // Do not focus the workspace here: the confirmation must hand it the keyboard itself.
    await userEvent.keyboard('{Shift>}e{/Shift}');
    await screen.findByRole('dialog', { name: /^Extrude · / });
  },
  30_000
);

it('keeps plain Enter, repeated keys and composing keys from confirming the sketch', async () => {
  const { canvas, dialog } = await openSketch();
  await userEvent.keyboard('{Enter}');
  expect(screen.getByRole('dialog', { name: /^Sketch · / })).toBe(dialog);
  fireEvent.keyDown(canvas, { key: 'Enter', ctrlKey: true, repeat: true });
  fireEvent.keyDown(canvas, { key: 'Enter', metaKey: true, isComposing: true, keyCode: 229 });
  await settled();
  expect(screen.getByRole('dialog', { name: /^Sketch · / })).toBe(dialog);
  expect(screen.queryByTestId('workspace-3d')).toBeNull();
  await userEvent.keyboard(confirmKeys);
  await screen.findByRole('toolbar', { name: 'Part Studio toolbar' });
}, 30_000);

it('keeps an empty sketch open with the same disabled reason as its green check', async () => {
  const source = createCadDocument();
  source.parts.push(createCadPart());
  const { dialog } = await openSketch(source);
  const confirm = within(dialog).getByRole('button', { name: /Finish sketch/ });
  expect(confirm).toHaveProperty('disabled', true);
  const reason = confirm.getAttribute('title');
  expect(reason).toBeTruthy();
  expect(confirm).toHaveAttribute('aria-description', reason);
  await userEvent.keyboard(confirmKeys);
  await settled();
  expect(screen.getByRole('dialog', { name: /^Sketch · / })).toBe(dialog);
  expect(confirm).toHaveAttribute('title', reason);
  expect(screen.queryByTestId('workspace-3d')).toBeNull();
}, 30_000);

it('keeps an incomplete drawing command open until it is completed or cancelled', async () => {
  const { canvas, dialog } = await openSketch();
  await userEvent.keyboard('g');
  const point = new DOMPoint(30, -30).matrixTransform(canvas.getScreenCTM()!);
  const bounds = canvas.getBoundingClientRect();
  await userEvent.click(canvas, { position: { x: point.x - bounds.left, y: point.y - bounds.top } });
  const confirm = within(dialog).getByRole('button', { name: /Finish sketch/ });
  expect(confirm).toHaveProperty('disabled', true);
  await userEvent.keyboard(confirmKeys);
  expect(screen.getByRole('dialog', { name: /^Sketch · / })).toBe(dialog);
  expect(canvas.classList.contains('cad-tool-rectangle')).toBe(true);
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(confirm).toHaveProperty('disabled', false));
  await userEvent.keyboard(confirmKeys);
  await screen.findByRole('toolbar', { name: 'Part Studio toolbar' });
}, 30_000);

it('applies a valid dimension still being typed before confirming the sketch', async () => {
  const { latest } = await openSketch();
  await userEvent.dblClick(screen.getByRole('button', { name: 'Edit Width: 120 mm' }));
  await userEvent.fill(screen.getByRole('textbox', { name: 'Width mm' }), '140');
  await userEvent.keyboard(confirmKeys);
  await screen.findByRole('toolbar', { name: 'Part Studio toolbar' });
  await waitFor(() =>
    expect(latest().parts[0]!.sketch.constraints.find(constraint => constraint.label === 'Width')).toMatchObject({ value: 140 })
  );
  await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('workspace-3d')));
}, 30_000);

it('retains an invalid dimension for correction when the confirmation shortcut is pressed', async () => {
  const { dialog, latest } = await openSketch();
  await userEvent.dblClick(screen.getByRole('button', { name: 'Edit Width: 120 mm' }));
  const input = screen.getByRole('textbox', { name: 'Width mm' });
  await userEvent.fill(input, '1,000');
  await userEvent.keyboard(confirmKeys);
  await waitFor(() => expect(screen.getAllByText(/Ambiguous comma group/).length).toBeGreaterThan(0));
  expect(screen.getByRole('dialog', { name: /^Sketch · / })).toBe(dialog);
  expect(input).toHaveValue('1,000');
  expect(document.activeElement).toBe(input);
  expect(latest().parts[0]!.sketch.constraints.find(constraint => constraint.label === 'Width')).toMatchObject({ value: 120 });
}, 30_000);

it('preserves native Space on Show constraints and confirms from that focused checkbox', async () => {
  const { dialog } = await openSketch();
  const checkbox = within(dialog).getByRole('checkbox', { name: 'Show constraints' });
  await userEvent.click(checkbox);
  expect(checkbox).not.toBeChecked();
  expect(document.activeElement).toBe(checkbox);
  await userEvent.keyboard(' ');
  expect(checkbox).toBeChecked();
  expect(document.activeElement).toBe(checkbox);
  expect(screen.getByRole('dialog', { name: /^Sketch · / })).toBe(dialog);
  await userEvent.keyboard(confirmKeys);
  await screen.findByRole('toolbar', { name: 'Part Studio toolbar' });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('workspace-3d')));
}, 30_000);

it('leaves confirmation keys with open tool search instead of closing the sketch', async () => {
  const { dialog } = await openSketch();
  await userEvent.click(screen.getByRole('button', { name: /Search tools/ }));
  const search = await screen.findByRole('combobox', { name: 'Search tools' });
  await waitFor(() => expect(document.activeElement).toBe(search));
  await userEvent.keyboard(confirmKeys);
  expect(screen.getByRole('dialog', { name: /^Sketch · / })).toBe(dialog);
  expect(screen.getByRole('combobox', { name: 'Search tools' })).toBe(search);
  expect(document.activeElement).toBe(search);
  await userEvent.fill(search, 'Line');
  await screen.findByRole('option', { name: 'Line L' });
  await userEvent.keyboard(confirmKeys);
  await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Search tools' })).toBeNull());
  expect(screen.getByRole('dialog', { name: /^Sketch · / })).toBe(dialog);
  expect(screen.getByRole('button', { name: 'Line (L)' })).toHaveAttribute('aria-pressed', 'true');
}, 30_000);

it('lists confirmation for an open studio sketch and omits it from the workspace shortcut list', async () => {
  const { dialog } = await openSketch();
  await userEvent.keyboard('?');
  const sketchList = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
  const sketchSection = within(sketchList).getByRole('region', { name: 'Sketch' });
  expect(within(sketchSection).getByText('Confirm sketch')).toBeDefined();
  expect(within(sketchSection).getByText('Ctrl/⌘+Enter')).toBeDefined();
  await userEvent.keyboard(confirmKeys);
  expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBe(sketchList);
  // Modal shortcut help hides the background editor from accessibility queries while it stays mounted.
  expect(dialog.isConnected).toBe(true);
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull());
  screen.getByTestId('cad-canvas').focus();
  await userEvent.keyboard(confirmKeys);
  await screen.findByRole('toolbar', { name: 'Part Studio toolbar' }, { timeout: 20_000 });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('workspace-3d')));
  await userEvent.keyboard('?');
  const studioList = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
  expect(within(studioList).queryByText('Confirm sketch')).toBeNull();
  expect(within(within(studioList).getByRole('region', { name: 'Part Studio' })).getByText('Extrude')).toBeDefined();
}, 30_000);

it('creates and applies a variable still being typed in a dimension before confirming', async () => {
  const { latest } = await openSketch();
  await userEvent.dblClick(screen.getByRole('button', { name: 'Edit Width: 120 mm' }));
  const input = screen.getByRole('textbox', { name: 'Width mm' });
  await userEvent.fill(input, '#span = 140mm');
  expect(document.activeElement).toBe(input);
  await userEvent.keyboard(confirmKeys);
  await waitFor(() => expect(latest().variables?.find(variable => variable.name === 'span')).toMatchObject({ expression: '140mm' }), {
    timeout: 20_000,
  });
  await screen.findByRole('toolbar', { name: 'Part Studio toolbar' }, { timeout: 20_000 });
  await waitFor(() =>
    expect(latest().parts[0]!.sketch.constraints.find(constraint => constraint.label === 'Width')).toMatchObject({
      value: 140,
      expression: '#span',
    })
  );
  await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('workspace-3d')));
}, 30_000);

it('does not confirm during a held selection gesture or defer it until pointer release', async () => {
  const { canvas, dialog } = await openSketch();
  vi.spyOn(canvas, 'setPointerCapture').mockImplementation(() => {});
  const point = new DOMPoint(30, -30).matrixTransform(canvas.getScreenCTM()!);
  const pointer = { button: 0, pointerId: 1, clientX: point.x, clientY: point.y };
  fireEvent.pointerDown(canvas, pointer);
  // Geometry is valid: only the in-progress pointer gesture prevents this request from confirming.
  expect(within(dialog).getByRole('button', { name: /Finish sketch/ })).toHaveProperty('disabled', false);
  await act(async () => userEvent.keyboard(confirmKeys));
  expect(screen.getByRole('dialog', { name: /^Sketch · / })).toBe(dialog);
  fireEvent.pointerUp(canvas, pointer);
  await settled();
  expect(screen.getByRole('dialog', { name: /^Sketch · / })).toBe(dialog);
  await userEvent.keyboard(confirmKeys);
  await screen.findByRole('toolbar', { name: 'Part Studio toolbar' });
}, 30_000);
