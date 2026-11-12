import { parseCadDocument, type CadDocument } from '@wbcnc/cad';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { ModelViewport } from '@/cam/model/ModelViewport';
import { endCadSession } from '@wbcnc/cad-editor/session';
import saved from '../../../../packages/cad-script/fixtures/designs/cupboard.json';
import { settled } from '@/test/settled';
import { studioCommand } from './studioToolbarTesting';

vi.mock('@/cam/model/ModelViewport', { spy: true });
// Opening the cupboard in a full editor, and every pick after it, can take longer than the default under load.
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

it('mirrors the part clicked once its part field is active, and keeps the dialog and the selection together until then', async () => {
  const { source, latest } = await open();
  await userEvent.click(await studioCommand(/^Mirror/));
  const dialog = await screen.findByRole('dialog', { name: 'Mirror' });
  const field = within(dialog).getByRole('button', { name: 'Entities to mirror' });
  expect(field.textContent).toContain('Shelf');
  // While the plane is being picked, a part click doesn't take the selection away from the dialog's part.
  await userEvent.click(row('Bottom'));
  expect(field.textContent).toContain('Shelf');
  expect(row('Shelf')).toHaveAttribute('aria-pressed', 'true');
  expect(row('Bottom')).toHaveAttribute('aria-pressed', 'false');
  await userEvent.click(field);
  expect(field).toHaveAttribute('data-active');
  expect(within(dialog).getByRole('button', { name: 'Mirror plane' })).not.toHaveAttribute('data-active');
  await userEvent.click(row('Bottom'));
  await waitFor(() => expect(field.textContent).toContain('Bottom'));
  expect(row('Bottom')).toHaveAttribute('aria-pressed', 'true');
  // With its part taken, the mirror goes on to its plane. Back on the part field, a click in the 3D view takes a part too.
  expect(within(dialog).getByRole('button', { name: 'Mirror plane' })).toHaveAttribute('data-active');
  await userEvent.click(field);
  const view = () => vi.mocked(ModelViewport).mock.calls.at(-1)![0];
  const back = named(source, 'Back');
  act(() => view().onSelect!(back.id, view().instanceIds!.indexOf(back.id)));
  await waitFor(() => expect(field.textContent).toContain('Back'));
  await userEvent.click(field);
  await userEvent.click(row('Bottom'));
  await waitFor(() => expect(field.textContent).toContain('Bottom'));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Mirror plane' }));
  const geometry = within(screen.getByRole('region', { name: 'Features' })).getByRole('list', { name: 'Default geometry' });
  await userEvent.click(within(geometry).getByRole('button', { name: /Top/ }));
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Mirror plane' }).textContent).toContain('top plane'));
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Mirror' })).toBeNull());
  expect(named(latest(), 'Bottom').copies).toHaveLength(1);
  expect(named(latest(), 'Bottom').copies![0]).toMatchObject({ mirrored: true, mirror: { across: { plane: 'top' } } });
  expect(named(latest(), 'Shelf').copies ?? []).toHaveLength(0);
}, 60_000);

it('patterns the part clicked while the dialog is open, with what was set up so far', async () => {
  const { latest } = await open();
  await userEvent.click(await studioCommand(/Pattern/));
  const dialog = await screen.findByRole('dialog', { name: /^Linear pattern/ });
  const field = within(dialog).getByRole('button', { name: 'Part to pattern' });
  expect(field.textContent).toContain('Shelf');
  expect(field).toHaveAttribute('data-active');
  const count = within(dialog).getByLabelText('How many');
  await userEvent.clear(count);
  await userEvent.type(count, '3');
  await userEvent.click(row('Bottom'));
  await waitFor(() => expect(field.textContent).toContain('Bottom'));
  expect(row('Bottom')).toHaveAttribute('aria-pressed', 'true');
  expect((within(dialog).getByLabelText('How many') as HTMLInputElement).value).toBe('3');
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(named(latest(), 'Bottom').pattern).toMatchObject({ count: 3 }));
  expect(named(latest(), 'Shelf').pattern).toBeUndefined();
}, 60_000);

it('moves the part clicked while the dialog is open', async () => {
  const { source, latest } = await open();
  await userEvent.click(await studioCommand(/Transform/));
  const dialog = await screen.findByRole('dialog', { name: /^Transform/ });
  const field = within(dialog).getByRole('button', { name: 'Part to move' });
  expect(field.textContent).toContain('Shelf');
  await userEvent.click(row('Bottom'));
  await waitFor(() => expect(field.textContent).toContain('Bottom'));
  expect(row('Bottom')).toHaveAttribute('aria-pressed', 'true');
  // Only one pick field shows as active: the part's, not the direction's or a connector's waiting for input.
  const active = () => [...dialog.querySelectorAll('.cad-feature-selection[data-active]')].map(field => field.getAttribute('aria-label'));
  const type = within(dialog).getByRole('combobox', { name: 'Transform type' });
  await userEvent.selectOptions(type, 'distance');
  expect(active()).toEqual(['Part to move']);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Direction' }));
  expect(active()).toEqual(['Direction']);
  await userEvent.click(field);
  expect(active()).toEqual(['Part to move']);
  await userEvent.selectOptions(type, 'mate');
  expect(active()).not.toContain('Part to move');
  expect(active()).toContain('Mate connector');
  await userEvent.click(field);
  expect(active()).toEqual(['Part to move']);
  await userEvent.selectOptions(type, 'xyz');
  const x = within(dialog).getByLabelText('X');
  await userEvent.clear(x);
  await userEvent.type(x, '50');
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(named(latest(), 'Bottom').moved).toMatchObject({ by: [50, 0, 0] }));
  expect(named(latest(), 'Shelf').moved).toEqual(named(source, 'Shelf').moved);
}, 60_000);

it('refuses a copy for the part, as its family is not what was clicked', async () => {
  const { source } = await open();
  await userEvent.click(await studioCommand(/Transform/));
  const dialog = await screen.findByRole('dialog', { name: /^Transform/ });
  const field = within(dialog).getByRole('button', { name: 'Part to move' });
  // The cupboard's second side is a copy of the first.
  const side = named(source, 'Side');
  const view = () => vi.mocked(ModelViewport).mock.calls.at(-1)![0];
  const copy = view().instanceIds!.indexOf(`${side.id}/${side.copies![0]!.id}`);
  expect(copy).toBeGreaterThanOrEqual(0);
  act(() => view().onSelect!(side.id, copy));
  await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toContain('not one of its copies'));
  expect(field.textContent).toContain('Shelf');
}, 60_000);
