import { parseCadDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from '@wbcnc/cad-editor/session';
import saved from '../../../../packages/cad-script/fixtures/designs/cupboard.json';
import { settled } from '@/test/settled';
import { studioCommand } from './studioToolbarTesting';

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});

const parts = () => within(screen.getByRole('list', { name: 'Parts' }));
const row = (name: string) => parts().getByRole('button', { name });
const named = (document: CadDocument, name: string) => document.parts.find(part => part.name === name)!;

async function open() {
  const source = parseCadDocument(structuredClone(saved));
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 800, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  await waitFor(() => expect(document.querySelector('.cad-editor')).toHaveAttribute('aria-busy', 'false'), { timeout: 30_000 });
  await settled({ timeout: 30_000 });
  await userEvent.click(row('Shelf'));
  await waitFor(() => expect(row('Shelf')).toHaveAttribute('aria-pressed', 'true'));
  return { source, latest: () => change.mock.calls.at(-1)?.[0] ?? source };
}

/** Opens a step and retargets it to Bottom with a click outside the dialog, leaving focus there. */
async function retarget(command: RegExp, title: RegExp, field: string) {
  const opened = await open();
  await userEvent.click(await studioCommand(command));
  const dialog = await screen.findByRole('dialog', { name: title });
  const part = within(dialog).getByRole('button', { name: field });
  if (!part.hasAttribute('data-active')) await userEvent.click(part);
  await userEvent.click(row('Bottom'));
  await waitFor(() => expect(part.textContent).toContain('Bottom'));
  expect(dialog.contains(document.activeElement)).toBe(false);
  return { ...opened, dialog, part };
}

// Opening the cupboard in a full editor, and every pick after it, can take longer than the default under load.
it.each([
  ['Transform', /Transform/, /^Transform/, 'Part to move'],
  ['Pattern', /Pattern/, /^Linear pattern/, 'Part to pattern'],
  ['Mirror', /^Mirror/, /^Mirror$/, 'Entities to mirror'],
] as const)(
  'cancels %s with Escape after a part is picked in the Parts list',
  async (_, command, title, field) => {
    const { source, latest } = await retarget(command, title, field);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: title })).toBeNull());
    expect(named(latest(), 'Bottom')).toEqual(named(source, 'Bottom'));
  },
  60_000
);

it('cancels Transform with Escape after a click in the 3D view', async () => {
  const { source, latest } = await open();
  await userEvent.click(await studioCommand(/Transform/));
  await screen.findByRole('dialog', { name: /^Transform/ });
  // Empty space in a corner of the view: no part is there.
  await userEvent.click(screen.getByTestId('workspace-3d').querySelector('canvas')!, { position: { x: 4, y: 4 } });
  expect(screen.getByTestId('workspace-3d').contains(document.activeElement)).toBe(true);
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Transform/ })).toBeNull());
  expect(latest().parts).toEqual(source.parts);
}, 60_000);

it('fills the Mirror plane with the plane clicked after its part is picked', async () => {
  const { latest } = await retarget(/^Mirror/, /^Mirror$/, 'Entities to mirror');
  const dialog = screen.getByRole('dialog', { name: 'Mirror' });
  const plane = within(dialog).getByRole('button', { name: 'Mirror plane' });
  // With the part taken, the mirror goes on to pick its plane.
  expect(plane).toHaveAttribute('data-active');
  expect(within(dialog).getByRole('button', { name: 'Entities to mirror' })).not.toHaveAttribute('data-active');
  const geometry = within(screen.getByRole('region', { name: 'Features' })).getByRole('list', { name: 'Default geometry' });
  await userEvent.click(within(geometry).getByRole('button', { name: /Top/ }));
  await waitFor(() => expect(plane.textContent).toContain('top plane'));
  const ok = within(dialog).getByRole('button', { name: 'OK' });
  expect(ok).not.toBeDisabled();
  await userEvent.click(ok);
  await waitFor(() => expect(named(latest(), 'Bottom').copies?.[0]).toMatchObject({ mirror: { across: { plane: 'top' } } }));
}, 60_000);
