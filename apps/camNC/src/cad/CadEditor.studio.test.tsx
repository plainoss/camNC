import { createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from './session';

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});
const settled = () =>
  waitFor(() => expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false'), { timeout: 20_000 });

async function studio() {
  const source = createPlateDocument({ width: 200, height: 100 });
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  const finish = vi.fn<(document: CadDocument) => Promise<void>>(async () => {});
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={change} onFinish={finish} onCancel={() => {}} />
    </div>
  );
  await settled();
  const latest = () => change.mock.calls.at(-1)?.[0] ?? source;
  return { latest, finish };
}

it('opens as a studio, with its own toolbar and steps set in dialogs that keep or drop their changes', async () => {
  const { latest } = await studio();
  const toolbar = await screen.findByRole('toolbar', { name: 'Part Studio toolbar' });
  expect(screen.queryByRole('toolbar', { name: 'Sketch toolbar' })).toBeNull();

  // A changed thickness shows straight away, and the cross puts it back.
  await userEvent.click(within(toolbar).getByRole('button', { name: /Extrude/ }));
  let dialog = await screen.findByRole('dialog', { name: 'Extrude · Plate' });
  const thickness = within(dialog).getByRole('textbox', { name: /Thickness/ });
  await userEvent.clear(thickness);
  await userEvent.type(thickness, '30');
  await userEvent.tab();
  await waitFor(() => expect(latest().parts[0]!.thickness).toBe(30));
  // The design can't be left with a step half set.
  expect(within(toolbar).getByRole('button', { name: /Done/ })).toHaveProperty('disabled', true);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(latest().parts[0]!.thickness).toBe(18));
  expect(screen.queryByRole('dialog', { name: 'Extrude · Plate' })).toBeNull();

  // The tick keeps it.
  await userEvent.click(within(toolbar).getByRole('button', { name: /Extrude/ }));
  dialog = screen.getByRole('dialog', { name: 'Extrude · Plate' });
  await userEvent.clear(within(dialog).getByRole('textbox', { name: /Thickness/ }));
  await userEvent.type(within(dialog).getByRole('textbox', { name: /Thickness/ }), '24');
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(latest().parts[0]!.thickness).toBe(24));
  expect(screen.queryByRole('dialog', { name: 'Extrude · Plate' })).toBeNull();

  // A pattern is set in its own dialog.
  await userEvent.click(within(toolbar).getByRole('button', { name: /Pattern/ }));
  dialog = screen.getByRole('dialog', { name: 'Linear pattern · Plate' });
  await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Pattern copies in a row' }));
  await waitFor(() => expect(latest().parts[0]!.copies).toHaveLength(1));
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  expect(latest().parts[0]!.pattern).toBeDefined();
});

it('opens a sketch from its step and closes it back to the studio, cancelling what changed in it', async () => {
  const { latest, finish } = await studio();
  await userEvent.click(within(screen.getByRole('region', { name: 'Steps' })).getByRole('button', { name: /Sketch · Plate/ }));
  const sketch = await screen.findByRole('dialog', { name: 'Sketch · Plate' });
  expect(screen.getByRole('toolbar', { name: 'Sketch toolbar' })).toBeDefined();
  // The toolbar has no way out of the design while sketching: the sketch's own dialog closes it.
  expect(screen.queryByRole('button', { name: '✓ Finish sketch' })).toBe(within(sketch).getByRole('button', { name: '✓ Finish sketch' }));
  const before = latest().parts[0]!.sketch;
  await userEvent.keyboard('{Control>}a{/Control}{Delete}');
  await settled();
  expect(latest().parts[0]!.sketch.entities.length).toBeLessThan(before.entities.length);
  await userEvent.click(within(sketch).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(latest().parts[0]!.sketch.entities).toHaveLength(before.entities.length));
  expect(await screen.findByRole('toolbar', { name: 'Part Studio toolbar' })).toBeDefined();
  expect(finish).not.toHaveBeenCalled();
  // Done is what leaves the design.
  await userEvent.click(screen.getByRole('button', { name: /Done/ }));
  await waitFor(() => expect(finish).toHaveBeenCalled());
});
