import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  // It's still one Extrude feature, making the three parts.
  const extrudes = () => within(features).getAllByRole('button', { name: /^Extrude · / });
  expect(extrudes()).toHaveLength(1);
  expect(extrudes()[0]!.textContent).toMatch(/3 parts/);
  const made = () => latest().parts.filter(part => part.sketchOf === selectme.id);
  const ids = made().map(part => part.id);
  // Edited again, the feature's parts all follow, and keep their ids.
  await userEvent.dblClick(extrudes()[0]!);
  const again = await screen.findByRole('dialog', { name: 'Extrude · Part 1' });
  await waitFor(() => expect(again.querySelector('.cad-feature-selection span')!.textContent).toBe('3 regions of selectme'));
  const thickness = within(again).getByRole('textbox', { name: /Thickness/ });
  await userEvent.clear(thickness);
  await userEvent.type(thickness, '30 mm{Enter}');
  await waitFor(() => expect(latest().parts.find(part => part.id === target.id)!.thickness).toBe(30));
  await userEvent.click(within(again).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Extrude · Part 1' })).toBeNull());
  await waitFor(() => expect(made().map(part => part.id)).toEqual(ids));
  expect(made().map(part => part.thickness)).toEqual([30, 30, 30]);
  expect(extrudes()).toHaveLength(1);
  // Made a Remove, it's still one feature, cutting all three regions; made New again, OK makes a part of each again.
  await userEvent.dblClick(extrudes()[0]!);
  const third = await screen.findByRole('dialog', { name: 'Extrude · Part 1' });
  const operation = within(third).getByRole('tablist', { name: 'Extrude operation' });
  await userEvent.click(within(operation).getByRole('tab', { name: 'Remove' }));
  await waitFor(() => expect(made()).toHaveLength(1));
  expect(made()[0]!.regions).toHaveLength(3);
  expect(extrudes()).toHaveLength(1);
  await userEvent.click(within(operation).getByRole('tab', { name: 'New' }));
  await waitFor(() => expect(third.querySelector('.cad-feature-selection span')!.textContent).toBe('3 regions of selectme'));
  await userEvent.click(within(third).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(made()).toHaveLength(3));
  expect(extrudes()).toHaveLength(1);
  // Deleting the feature deletes every part it made.
  fireEvent.contextMenu(extrudes()[0]!);
  await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Delete' }));
  await waitFor(() => expect(made()).toEqual([]));
  expect(within(features).queryAllByRole('button', { name: /^Extrude · / })).toHaveLength(0);
}, 60_000);
