import { parseCadDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from '@wbcnc/cad-editor/session';
import saved from '../../../../packages/cad-script/fixtures/designs/plate.json';
import { settled } from '@/test/settled';
import { studioCommand } from './studioToolbarTesting';

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});

it.each([
  ['30O', 'keys', 'Unknown unit: O.'],
  ['30O', 'replace', 'Unknown unit: O.'],
  ['abc', 'replace', null],
  ['gap/0', 'replace', null],
] as const)('refuses OK on spacing %s (%s) and commits only what the field shows', async (typed, edit, message) => {
  const source = parseCadDocument(structuredClone(saved));
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  const latest = () => change.mock.calls.at(-1)?.[0] ?? source;
  render(
    <div style={{ height: 800, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  await waitFor(() => expect(document.querySelector('.cad-editor')).toHaveAttribute('aria-busy', 'false'), { timeout: 30_000 });
  await settled({ timeout: 30_000 });
  await userEvent.click(within(screen.getByRole('list', { name: 'Parts' })).getByRole('button', { name: 'Plate' }));
  await userEvent.click(await studioCommand(/Pattern/));
  const dialog = await screen.findByRole('dialog', { name: /^Linear pattern/ });
  const ok = within(dialog).getByRole('button', { name: 'OK' });
  await userEvent.fill(within(dialog).getByLabelText('How many'), '3');
  const spacing = within(dialog).getByLabelText(/^Spacing/) as HTMLInputElement;
  await userEvent.fill(spacing, '300');
  expect(within(dialog).queryByRole('alert')).toBeNull();
  if (edit === 'keys') {
    // Key by key, the field passes through 30, which reads, on the way to 30O.
    await userEvent.type(spacing, '{Backspace}O');
  } else await userEvent.fill(spacing, typed);
  expect(spacing.value).toBe(typed);
  const alert = await within(dialog).findByRole('alert');
  if (message) expect(alert.textContent).toBe(message);
  expect(ok).toBeDisabled();
  expect(ok.getAttribute('title')).toBe(alert.textContent);
  // Leaving the field, as a click on OK does, keeps it refused.
  await userEvent.click(within(dialog).getByLabelText('How many'));
  expect(ok).toBeDisabled();
  expect(screen.getByRole('dialog', { name: /^Linear pattern/ })).toBe(dialog);
  expect(latest().parts[0]!.pattern).toBeUndefined();
  // Corrected, it keeps exactly what the field then shows.
  await userEvent.fill(spacing, '40');
  await waitFor(() => expect(ok).not.toBeDisabled());
  expect(within(dialog).queryByRole('alert')).toBeNull();
  await userEvent.click(ok);
  await waitFor(() => expect(latest().parts[0]!.pattern).toMatchObject({ count: 3, spacing: 40 }));
});
