import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { parseCadDocument, type CadDocument } from '@wbcnc/cad';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import saved from '../../../../packages/cad-script/fixtures/designs/extrude-sketch-apart.json';

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});

it('names the sketch to extrude as the feature list does, and picks all of its shapes apart when it’s chosen', async () => {
  const source = parseCadDocument(structuredClone(saved));
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  await waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20_000 });
  const latest = () => change.mock.calls.at(-1)?.[0] ?? source;
  const features = screen.getByRole('region', { name: 'Features' });
  await userEvent.dblClick(within(features).getByRole('button', { name: /^Extrude · Part 1\b/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Extrude · Part 1' });
  const chooser = dialog.querySelector('.cad-feature-selection span')!;
  expect(chooser.textContent).toBe('selectme');
  const pick = within(dialog).getByRole('button', { name: 'Select profile' });
  if (pick.getAttribute('aria-pressed') !== 'true') await userEvent.click(pick);
  await userEvent.click(within(features).getByRole('button', { name: /^selectme/ }));
  await waitFor(() => expect(chooser.textContent).toBe('3 regions of selectme'));
  const target = latest().parts.find(part => part.name === 'Part 1')!;
  expect(target.regions).toHaveLength(3);
  expect(within(dialog).queryByRole('alert')).toBeNull();
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Extrude · Part 1' })).toBeNull());
  // Each shape apart is a part of its own.
  const selectme = latest().parts.find(part => part.sketchName === 'selectme')!;
  await waitFor(() => expect(latest().parts.filter(part => part.sketchOf === selectme.id)).toHaveLength(3));
}, 40_000);
