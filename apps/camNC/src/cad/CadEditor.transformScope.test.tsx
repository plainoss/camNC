import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { createPlateDocument, parseCadDocument, resolvePartPatterns, type CadDocument } from '@wbcnc/cad';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { afterEach, expect, it, vi } from 'vitest';
import { ModelViewport } from '@/cam/model/ModelViewport';
import { CadEditor } from './CadEditor';
import { solveCadDocument } from './solveCad';
import tray from '../../../../packages/cad-script/fixtures/designs/divided-tray.json';
import { studioCommand } from './studioToolbarTesting';

vi.mock('@/cam/model/ModelViewport', { spy: true });
const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});
const viewport = () => vi.mocked(ModelViewport).mock.calls.at(-1)![0];

async function studio(source: CadDocument) {
  // Normalize placements before mounting so the editor's initial solver result cannot masquerade as a tool edit.
  source = (await solveCadDocument(source)).document;
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  await waitFor(() => expect(document.querySelector('.cad-editor')).toHaveAttribute('aria-busy', 'false'), { timeout: 20_000 });
  await waitFor(() => expect(viewport().instanceIds).toContain(source.parts[0]!.id), { timeout: 10_000 });
  change.mockClear();
  return { change, latest: () => change.mock.calls.at(-1)?.[0] ?? source };
}

it.each(['viewport', 'Parts list'])('refuses to widen a patterned tray divider picked in the %s to its whole family', async selection => {
  const source = parseCadDocument(structuredClone(tray));
  const divider = source.parts.find(part => part.name === 'Divider')!;
  const copy = divider.copies![0]!;
  const { change, latest } = await studio(source);
  const copyRow = () => within(screen.getByRole('list', { name: 'Parts' })).getByRole('button', { name: 'Divider 2' });
  if (selection === 'viewport') {
    const index = viewport().instanceIds!.indexOf(`${divider.id}/${copy.id}`);
    expect(index).toBeGreaterThanOrEqual(0);
    act(() => viewport().onSelect(divider.id, index, { partId: divider.id, index, point: [144, 20, 52], normal: [0, 0, 1] }));
  } else await userEvent.click(copyRow());
  expect(copyRow()).toHaveAttribute('aria-pressed', 'true');
  const before = structuredClone(latest());
  const instances = [...viewport().instanceIds!];
  await userEvent.click(await studioCommand(/Transform/));
  expect(screen.queryByRole('dialog', { name: /^Transform/ })).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('Select the source part in Parts to transform its whole family.');
  expect(copyRow()).toHaveAttribute('aria-pressed', 'true');
  expect(change).not.toHaveBeenCalled();
  expect(latest()).toEqual(before);
  expect(viewport().instanceIds).toEqual(instances);

  // Explicit family selection permits the established source-before-pattern operation.
  await userEvent.click(within(screen.getByRole('list', { name: 'Parts' })).getByRole('button', { name: 'Divider' }));
  await userEvent.click(await studioCommand(/Transform/));
  const dialog = await screen.findByRole('dialog', { name: /^Transform/ });
  expect(screen.queryByRole('alert')).toBeNull();
  const x = within(dialog).getByRole('textbox', { name: 'X' });
  await userEvent.clear(x);
  await userEvent.type(x, '50');
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(latest().parts.find(part => part.id === divider.id)?.moved).toEqual({ by: [50, 0, 0] }));
  expect(
    latest()
      .parts.find(part => part.id === divider.id)
      ?.copies?.map(copy => copy.id)
  ).toEqual(divider.copies!.map(copy => copy.id));
  expect(latest().parts.filter(part => part.id !== divider.id)).toEqual(before.parts.filter(part => part.id !== divider.id));
});

it('keeps a disappeared pattern copy from becoming a source transform', async () => {
  const source = parseCadDocument(structuredClone(tray));
  const { change, latest } = await studio(source);
  await userEvent.click(within(screen.getByRole('list', { name: 'Parts' })).getByRole('button', { name: 'Divider 3' }));
  await userEvent.dblClick(within(screen.getByRole('region', { name: 'Features' })).getByRole('button', { name: /^#dividers/ }));
  const dialog = await screen.findByRole('dialog', { name: '#dividers' });
  const value = within(dialog).getByRole('textbox', { name: 'Value' });
  await userEvent.clear(value);
  await userEvent.type(value, '2');
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  // Built membership, rather than worker readiness alone, determines whether the selected copy still exists.
  await waitFor(() => expect(within(screen.getByRole('list', { name: 'Parts' })).queryByRole('button', { name: 'Divider 3' })).toBeNull());
  await waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull());
  const before = structuredClone(latest());
  const calls = change.mock.calls.length;
  await userEvent.click(await studioCommand(/Transform/));
  expect(screen.queryByRole('dialog', { name: /^Transform/ })).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('Select the source part in Parts to transform its whole family.');
  expect(change).toHaveBeenCalledTimes(calls);
  expect(latest()).toEqual(before);
});

it.each([false, true])('refuses a new family transform from a selected standalone copy (mirrored: %s)', async mirrored => {
  const source = createPlateDocument({ width: 200, height: 100 });
  const part = source.parts[0]!;
  part.drawnOn = { on: { plane: 'top' }, offset: 0 };
  part.copies = [{ id: 'copy', name: 'Selected copy', offset: { position: [300, 0, 0], rotation: [0, 0, 0, 1] }, mirrored }];
  const { change } = await studio(resolvePartPatterns(source));
  await userEvent.click(within(screen.getByRole('list', { name: 'Parts' })).getByRole('button', { name: 'Selected copy' }));
  await userEvent.click(await studioCommand(/Transform/));
  expect(screen.queryByRole('dialog', { name: /^Transform/ })).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('Transforming only the selected copy is not supported.');
  expect(change).not.toHaveBeenCalled();
});
