import { createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { CadEditor } from './CadEditor';

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});
const settled = () =>
  waitFor(() => expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false'), { timeout: 20_000 });

/** A plate 18 thick, with its depth committed as 25 through the Extrude dialog: the change Undo must reach next. */
async function studioWithCommittedDepth() {
  const source = createPlateDocument({ width: 200, height: 100, thickness: 18 });
  sessions.push(source.id);
  const seen: CadDocument[] = [];
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={value => seen.push(value)} onFinish={async () => {}} onCancel={() => {}} />
    </div>
  );
  await settled();
  const latest = () => seen.at(-1) ?? source;
  const thickness = () => latest().parts[0]!.thickness;
  const features = await screen.findByRole('region', { name: 'Features' });
  const editDepth = async (value: string) => {
    await userEvent.dblClick(within(features).getByRole('button', { name: /^Extrude · Plate/ }));
    const dialog = await screen.findByRole('dialog', { name: /^Extrude · Plate/ });
    const field = within(dialog).getByRole('textbox', { name: /Thickness/ });
    // One input event, so the committed edit is a single undo step and not one per keystroke.
    await userEvent.fill(field, value);
    await userEvent.keyboard('{Enter}');
    await settled();
    return dialog;
  };
  const closed = () => waitFor(() => expect(screen.queryByRole('dialog', { name: /^Extrude · Plate/ })).toBeNull());
  await userEvent.click(within(await editDepth('25')).getByRole('button', { name: 'OK' }));
  await closed();
  expect(thickness()).toBe(25);
  const undo = () => userEvent.click(screen.getByRole('button', { name: 'Undo (Ctrl or Command Z)' }));
  const redoButton = () => screen.getByRole('button', { name: /^Redo/ }) as HTMLButtonElement;
  return { seen, latest, thickness, editDepth, closed, undo, redoButton };
}

it('leaves no history step when an Extrude dialog is cancelled, so Undo and Redo skip the cancelled edit', async () => {
  const { seen, thickness, editDepth, closed, undo, redoButton } = await studioWithCommittedDepth();
  const dialog = await editDepth('30');
  expect(thickness()).toBe(30);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await closed();
  expect(thickness()).toBe(25);
  seen.length = 0;

  await undo();
  await waitFor(() => expect(thickness()).toBe(18));
  await userEvent.click(redoButton());
  await waitFor(() => expect(thickness()).toBe(25));
  // The cancelled preview isn't on either stack: nothing more to redo, and Undo goes straight back to 18.
  expect(redoButton().disabled).toBe(true);
  await undo();
  await waitFor(() => expect(thickness()).toBe(18));
  expect(seen.map(document => document.parts[0]!.thickness)).not.toContain(30);
}, 60_000);

it('leaves no history step when a sketch is cancelled, and still offers to restore it', async () => {
  const { seen, latest, thickness, undo, redoButton } = await studioWithCommittedDepth();
  await userEvent.click(within(screen.getByRole('toolbar', { name: 'Part Studio toolbar' })).getByRole('button', { name: /Sketch/ }));
  await userEvent.click(within(screen.getByRole('list', { name: 'Default geometry' })).getByRole('button', { name: /Top/ }));
  const dialog = await screen.findByRole('dialog', { name: /^Sketch · / });
  await settled();
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  vi.spyOn(canvas, 'setPointerCapture').mockImplementation(() => {});
  fireEvent.keyDown(canvas, { key: 'l' });
  for (const [x, y] of [
    [20, 20],
    [80, 40],
  ]) {
    const at = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: at.x, clientY: at.y });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 1, clientX: at.x, clientY: at.y });
  }
  fireEvent.keyDown(canvas, { key: 'Escape' });
  await settled();
  const sketched = latest().parts.at(-1)!;
  expect(sketched.sketch.entities.some(entity => entity.type === 'line')).toBe(true);

  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect((await screen.findByRole('button', { name: 'Restore' })).closest('[role="status"]')?.textContent).toContain('Sketch cancelled.');
  expect(latest().parts).toHaveLength(1);
  expect(thickness()).toBe(25);
  seen.length = 0;

  // Undo reaches the depth committed before the sketch opened; neither stack holds the cancelled sketch.
  await undo();
  await waitFor(() => expect(thickness()).toBe(18));
  await userEvent.click(redoButton());
  await waitFor(() => expect(thickness()).toBe(25));
  expect(redoButton().disabled).toBe(true);
  await undo();
  await waitFor(() => expect(thickness()).toBe(18));
  expect(seen.some(document => document.parts.some(part => part.id === sketched.id))).toBe(false);
}, 60_000);
