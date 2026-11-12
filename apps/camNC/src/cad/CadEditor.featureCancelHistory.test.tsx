import { createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it } from 'vitest';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { CadEditor } from './CadEditor';

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});
const settled = () =>
  waitFor(() => expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false'), { timeout: 20_000 });

it('leaves no history step when an Extrude dialog is cancelled, so Undo and Redo skip the cancelled edit', async () => {
  const source = createPlateDocument({ width: 200, height: 100, thickness: 18 });
  sessions.push(source.id);
  let latest: CadDocument = source;
  const seen: number[] = [];
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor
        document={source}
        startIn3D
        onDraftChange={value => {
          latest = value;
          seen.push(value.parts[0]!.thickness);
        }}
        onFinish={async () => {}}
        onCancel={() => {}}
      />
    </div>
  );
  await settled();
  const thickness = () => latest.parts[0]!.thickness;
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

  // The committed change the cancelled dialog must not hide from Undo.
  await userEvent.click(within(await editDepth('25')).getByRole('button', { name: 'OK' }));
  await closed();
  expect(thickness()).toBe(25);

  const dialog = await editDepth('30');
  expect(thickness()).toBe(30);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await closed();
  expect(thickness()).toBe(25);
  seen.length = 0;

  await userEvent.click(screen.getByRole('button', { name: 'Undo (Ctrl or Command Z)' }));
  await waitFor(() => expect(thickness()).toBe(18));
  const redo = screen.getByRole('button', { name: /^Redo/ });
  await userEvent.click(redo);
  await waitFor(() => expect(thickness()).toBe(25));
  // The cancelled preview isn't on either stack: nothing more to redo, and Undo goes straight back to 18.
  expect((redo as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Undo (Ctrl or Command Z)' }));
  await waitFor(() => expect(thickness()).toBe(18));
  expect(seen).not.toContain(30);
}, 60_000);
