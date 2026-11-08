import { createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  // Double-clicking a feature edits it; for a sketch, that opens it.
  await userEvent.dblClick(within(screen.getByRole('region', { name: 'Features' })).getByRole('button', { name: /Sketch · Plate/ }));
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

it('lists variables with the steps, edits them in a dialog, and offers a menu on each feature', async () => {
  const { latest } = await studio();
  const toolbar = await screen.findByRole('toolbar', { name: 'Part Studio toolbar' });
  await userEvent.click(within(toolbar).getByRole('button', { name: /Variable/ }));
  let dialog = screen.getByRole('dialog', { name: 'Variable' });
  await userEvent.type(within(dialog).getByRole('textbox', { name: /Name/ }), 'board');
  await userEvent.type(within(dialog).getByRole('textbox', { name: /Value/ }), '19 mm');
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  const features = screen.getByRole('region', { name: 'Features' });
  await waitFor(() =>
    expect(
      within(features)
        .getAllByRole('button')
        .map(button => button.textContent)[0]
    ).toMatch(/#board = 19 mm/)
  );
  expect(latest().variables?.map(variable => variable.name)).toEqual(['board']);

  // Double-clicking it opens it again.
  await userEvent.dblClick(within(features).getByRole('button', { name: /#board/ }));
  dialog = screen.getByRole('dialog', { name: '#board' });
  await userEvent.clear(within(dialog).getByRole('textbox', { name: /Value/ }));
  await userEvent.type(within(dialog).getByRole('textbox', { name: /Value/ }), '12 mm');
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(within(features).getByRole('button', { name: /#board = 12 mm/ })).toBeDefined());

  // A step's menu renames its part in place, and edits it.
  fireEvent.contextMenu(within(features).getByRole('button', { name: /Extrude · Plate/ }));
  const menu = screen.getByRole('menu');
  expect(
    within(menu)
      .getAllByRole('menuitem')
      .map(item => item.textContent)
  ).toEqual(['Rename', 'Edit…', 'Edit sketch…', 'Suppress', 'Delete']);
  expect(within(menu).getByRole('menuitem', { name: 'Suppress' }).getAttribute('aria-disabled')).toBe('true');
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'Rename' }));
  const name = within(features).getByRole('textbox', { name: 'New name' });
  await userEvent.clear(name);
  await userEvent.type(name, 'Shelf{Enter}');
  await waitFor(() => expect(latest().parts[0]!.name).toBe('Shelf'));
  fireEvent.contextMenu(within(features).getByRole('button', { name: /Extrude · Shelf/ }));
  await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Edit…' }));
  expect(await screen.findByRole('dialog', { name: 'Extrude · Shelf' })).toBeDefined();

  // Deleting the extrude deletes the part, and undo brings it back.
  await userEvent.click(screen.getByRole('dialog', { name: 'Extrude · Shelf' }).querySelector('.cad-feature-cancel')!);
  fireEvent.contextMenu(within(features).getByRole('button', { name: /Extrude · Shelf/ }));
  await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Delete' }));
  await waitFor(() => expect(latest().parts).toHaveLength(0));
  await userEvent.click(within(toolbar).getByRole('button', { name: /^Undo/ }));
  await waitFor(() => expect(latest().parts).toHaveLength(1));
});
