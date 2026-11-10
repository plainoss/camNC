import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { createPlateDocument, parseCadDocument, resolvePartPatterns, type CadDocument } from '@wbcnc/cad';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { afterEach, expect, it, vi } from 'vitest';
import { ModelViewport } from '@/cam/model/ModelViewport';
import { CadEditor } from './CadEditor';
import { solveCadDocument } from './solveCad';
import tray from '../../../../packages/cad-script/fixtures/designs/divided-tray.json';

vi.mock('@/cam/model/ModelViewport', { spy: true });
const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});
const viewport = () => vi.mocked(ModelViewport).mock.calls.at(-1)![0];
const toolbar = () => within(screen.getByRole('toolbar', { name: 'Part Studio toolbar' }));
const parts = () => within(screen.getByRole('list', { name: 'Parts' }));
const refusal = 'Patterning only the selected copy is not supported. Select the source part in Parts to pattern its whole family.';

async function studio(source: CadDocument) {
  // Normalize source placements before mounting; initial solve output is not a command edit.
  source = (await solveCadDocument(source)).document;
  sessions.push(source.id);
  vi.mocked(ModelViewport).mockClear();
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  // Mount readiness and this fixture's physical membership must precede viewport picks.
  await screen.findByTestId('workspace-3d', {}, { timeout: 20_000 });
  await waitFor(() => expect(document.querySelector('.cad-editor')).toHaveAttribute('aria-busy', 'false'), { timeout: 20_000 });
  await waitFor(() => expect(viewport().instanceIds).toContain(source.parts[0]!.id), { timeout: 10_000 });
  change.mockClear();
  return { change, latest: () => change.mock.calls.at(-1)?.[0] ?? source };
}

it.each(['viewport', 'Parts list'])(
  'refuses to widen a complete tray divider picked in the %s and permits explicit source pattern edits',
  async selection => {
    const source = parseCadDocument(structuredClone(tray));
    expect(source.parts.map(part => part.name)).toEqual(['Base', 'Left wall', 'Right wall', 'Front wall', 'Back wall', 'Divider']);
    const divider = source.parts.find(part => part.name === 'Divider')!;
    const copy = divider.copies![0]!;
    const { change, latest } = await studio(source);
    const copyRow = () => parts().getByRole('button', { name: 'Divider 2' });
    if (selection === 'viewport') {
      const index = viewport().instanceIds!.indexOf(`${divider.id}/${copy.id}`);
      expect(index).toBeGreaterThanOrEqual(0);
      act(() => viewport().onSelect(divider.id, index, { partId: divider.id, index, point: [144, 20, 52], normal: [0, 0, 1] }));
    } else await userEvent.click(copyRow());
    expect(copyRow()).toHaveAttribute('aria-pressed', 'true');
    const before = structuredClone(latest());
    const instances = [...viewport().instanceIds!];
    await userEvent.click(toolbar().getByRole('button', { name: /Pattern/ }));
    expect(screen.queryByRole('dialog', { name: /^Linear pattern/ })).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe(refusal);
    expect(copyRow()).toHaveAttribute('aria-pressed', 'true');
    expect(change).not.toHaveBeenCalled();
    expect(latest()).toEqual(before);
    expect(viewport().instanceIds).toEqual(instances);

    // A deliberate source pick retains the established whole-family operation.
    await userEvent.click(parts().getByRole('button', { name: 'Divider' }));
    await userEvent.click(toolbar().getByRole('button', { name: /Pattern/ }));
    const dialog = await screen.findByRole('dialog', { name: /^Linear pattern/ });
    expect(screen.queryByRole('alert')).toBeNull();
    const count = within(dialog).getByRole('textbox', { name: 'How many' });
    expect(count).toHaveValue('dividers');
    await userEvent.clear(count);
    await userEvent.type(count, '4');
    await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(latest().parts.find(part => part.id === divider.id)?.pattern?.count).toBe(4));
    const family = latest().parts.find(part => part.id === divider.id)!;
    expect(family.pattern!.id).toBe(divider.pattern!.id);
    expect(family.copies).toHaveLength(3);
    expect(family.copies!.slice(0, 2).map(copy => copy.id)).toEqual(divider.copies!.map(copy => copy.id));
    expect(latest().parts.filter(part => part.id !== divider.id)).toEqual(before.parts.filter(part => part.id !== divider.id));
  }
);

it('keeps a disappeared selected pattern slot from silently opening the source pattern', async () => {
  const { change, latest } = await studio(parseCadDocument(structuredClone(tray)));
  await userEvent.click(parts().getByRole('button', { name: 'Divider 3' }));
  await userEvent.dblClick(within(screen.getByRole('region', { name: 'Features' })).getByRole('button', { name: /^#dividers/ }));
  const dialog = await screen.findByRole('dialog', { name: '#dividers' });
  const value = within(dialog).getByRole('textbox', { name: 'Value' });
  await userEvent.clear(value);
  await userEvent.type(value, '2');
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  // Actual membership, not just worker readiness, proves the raw selected slot disappeared.
  await waitFor(() => expect(parts().queryByRole('button', { name: 'Divider 3' })).toBeNull());
  await waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull());
  const before = structuredClone(latest());
  const calls = change.mock.calls.length;
  const instances = [...viewport().instanceIds!];
  await userEvent.click(toolbar().getByRole('button', { name: /Pattern/ }));
  expect(screen.queryByRole('dialog', { name: /^Linear pattern/ })).toBeNull();
  expect(screen.getByRole('alert').textContent).toBe(refusal);
  expect(change).toHaveBeenCalledTimes(calls);
  expect(latest()).toEqual(before);
  expect(viewport().instanceIds).toEqual(instances);
});

it.each([false, true])('refuses to create a family pattern from a standalone copy (mirrored: %s)', async mirrored => {
  const source = createPlateDocument({ width: 200, height: 100 });
  const part = source.parts[0]!;
  part.drawnOn = { on: { plane: 'top' }, offset: 0 };
  part.copies = [{ id: 'copy', name: 'Selected copy', offset: { position: [300, 0, 0], rotation: [0, 0, 0, 1] }, mirrored }];
  const { change, latest } = await studio(resolvePartPatterns(source));
  const copyRow = () => parts().getByRole('button', { name: 'Selected copy' });
  await userEvent.click(copyRow());
  const before = structuredClone(latest());
  const instances = [...viewport().instanceIds!];
  await userEvent.click(toolbar().getByRole('button', { name: /Pattern/ }));
  expect(screen.queryByRole('dialog', { name: /^Linear pattern/ })).toBeNull();
  expect(screen.getByRole('alert').textContent).toBe(refusal);
  expect(copyRow()).toHaveAttribute('aria-pressed', 'true');
  expect(change).not.toHaveBeenCalled();
  expect(latest()).toEqual(before);
  expect(latest().parts[0]!.pattern).toBeUndefined();
  expect(viewport().instanceIds).toEqual(instances);
});
