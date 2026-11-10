import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { evaluateCadDocument, parseCadDocument, type CadDocument } from '@wbcnc/cad';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import saved from '../../../../packages/cad-script/fixtures/designs/extrude-three-profiles.json';

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});

async function studio() {
  const source = parseCadDocument(structuredClone(saved));
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  // Initial solver normalization must finish before the test measures profile-edit publications.
  await waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20_000 });
  const features = screen.getByRole('region', { name: 'Features' });
  await userEvent.dblClick(within(features).getByRole('button', { name: /Extrude · Part 2/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Extrude · Part 2' });
  expect(within(dialog).getByText('2 regions of Part 2’s sketch')).toBeDefined();
  const pick = within(dialog).getByRole('button', { name: 'Select profile' });
  if (pick.getAttribute('aria-pressed') !== 'true') await userEvent.click(pick);
  return { source, features, dialog, latest: () => change.mock.calls.at(-1)?.[0] ?? source };
}

it('selects every eligible region from the source sketch row while editing Remove and retains settings through confirm and reload', async () => {
  const { source, features, dialog, latest } = await studio();
  await userEvent.click(within(features).getByRole('button', { name: /Sketch · Part 2/ }));
  await waitFor(() => expect(within(dialog).getByText('Part 2’s sketch')).toBeDefined());
  expect(latest().parts[1]!.regions).toBeUndefined();
  expect(latest().parts[1]!.id).toBe(source.parts[1]!.id);
  expect(latest().parts[1]!.sketch.id).toBe(source.parts[1]!.sketch.id);
  expect(latest().parts[1]!.remove).toEqual({ depth: 6 });
  expect(latest().parts[1]!.drawnOn).toEqual(source.parts[1]!.drawnOn);
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Extrude · Part 2' })).toBeNull());
  const restored = parseCadDocument(JSON.parse(JSON.stringify(latest())));
  expect(restored.parts[1]!.regions).toBeUndefined();
  const evaluated = evaluateCadDocument(restored);
  expect(evaluated.parts[0]!.cuts).toHaveLength(3);
  expect(evaluated.parts[0]!.cuts!.map(cut => cut.to - cut.from)).toEqual([6, 6, 6]);
  await userEvent.click(screen.getByRole('button', { name: /^Undo/ }));
  await waitFor(() => expect(latest().parts[1]!.regions).toEqual(source.parts[1]!.regions));
  await userEvent.click(screen.getByRole('button', { name: /^Redo/ }));
  await waitFor(() => expect(latest().parts[1]!.regions).toBeUndefined());
}, 40_000);

it('keeps a disabled profile picker passive and restores the original subset when the active edit is cancelled', async () => {
  const { source, features, dialog, latest } = await studio();
  const pick = within(dialog).getByRole('button', { name: 'Select profile' });
  await userEvent.click(pick);
  await userEvent.click(within(features).getByRole('button', { name: /Sketch · Part 2/ }));
  expect(latest().parts[1]!.regions).toEqual(source.parts[1]!.regions);
  await userEvent.click(pick);
  await userEvent.click(within(features).getByRole('button', { name: /Sketch · Part 2/ }));
  await waitFor(() => expect(latest().parts[1]!.regions).toBeUndefined());
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(latest().parts[1]!.regions).toEqual(source.parts[1]!.regions));
  expect(latest().parts[1]!.remove).toEqual({ depth: 6 });
}, 40_000);
