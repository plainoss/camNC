import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { createPlateDocument, parseCadDocument, type CadDocument } from '@wbcnc/cad';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { afterEach, expect, it, vi } from 'vitest';
import { ModelViewport } from '@/cam/model/ModelViewport';
import { CadEditor } from './CadEditor';
import { saveShownState } from './shownState';
import { solveCadDocument } from './solveCad';
import cabinet from '../../../../packages/cad-script/fixtures/designs/cabinet-consumed-cable-chase.json';

vi.mock('@/cam/model/ModelViewport', { spy: true });
const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(id => {
    endCadSession(id);
    saveShownState(id, { hiddenParts: [], featureVisibility: {} });
  });
});
const viewport = () => vi.mocked(ModelViewport).mock.calls.at(-1)![0];
const parts = () => within(screen.getByRole('list', { name: 'Parts' }));
const ready = () =>
  waitFor(
    () => {
      expect(document.querySelector('.cad-editor')).toHaveAttribute('aria-busy', 'false');
      expect(screen.queryByText(/^Checking sketch/)).toBeNull();
    },
    { timeout: 20_000 }
  );
async function studio(given: CadDocument) {
  const source = (await solveCadDocument(given)).document;
  saveShownState(source.id, { hiddenParts: [], featureVisibility: {} });
  sessions.push(source.id);
  vi.mocked(ModelViewport).mockClear();
  const changed = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={changed} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  await screen.findByTestId('workspace-3d', {}, { timeout: 20_000 });
  await ready();
  await waitFor(() => expect(viewport().instanceIds).toContain(source.parts[0]!.id));
  changed.mockClear();
  return { source, changed, latest: () => changed.mock.calls.at(-1)?.[0] ?? source };
}
async function shortcut(key: string) {
  screen.getByTestId('workspace-3d').focus();
  await userEvent.keyboard(`{Shift>}${key}{/Shift}`);
}
function topArea(mesh: ReturnType<typeof viewport>['meshes'][number]) {
  const top = Math.max(...Array.from(mesh.positions).filter((_, i) => i % 3 === 2));
  let area = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const at = [0, 1, 2].map(k => mesh.indices[i + k]! * 3);
    if (!at.every(j => Math.abs(mesh.positions[j + 2]! - top) < 1e-5)) continue;
    const [a, b, c] = at as [number, number, number];
    area +=
      Math.abs(
        (mesh.positions[b]! - mesh.positions[a]!) * (mesh.positions[c + 1]! - mesh.positions[a + 1]!) -
          (mesh.positions[b + 1]! - mesh.positions[a + 1]!) * (mesh.positions[c]! - mesh.positions[a]!)
      ) / 2;
  }
  return area;
}

it.each(['Parts', 'viewport'])(
  'isolates the actual notched Shelf 3 selected in %s and restores visibility without editing the cabinet',
  async selection => {
    const { source, changed, latest } = await studio(parseCadDocument(structuredClone(cabinet)));
    const shelf = source.parts.find(p => p.name === 'Shelf')!;
    const copy = shelf.copies![1]!;
    const key = `${shelf.id}/${copy.id}`;
    const before = structuredClone(latest());
    const original = viewport().meshes[viewport().instanceIds!.indexOf(key)]!;
    expect(topArea(original)).toBeCloseTo(215808, 3);
    // An existing eye choice must return when Isolate is toggled off.
    await userEvent.click(parts().getByRole('button', { name: 'Hide Side' }));
    const shownBefore = [...viewport().instanceIds!];
    if (selection === 'Parts') await userEvent.click(parts().getByRole('button', { name: 'Shelf 3' }));
    else {
      const index = viewport().instanceIds!.indexOf(key);
      act(() => viewport().onSelect(shelf.id, index, { partId: shelf.id, index, point: [130, 50, 679.5], normal: [0, 0, 1] }));
    }
    expect(parts().getByRole('button', { name: 'Shelf 3' })).toHaveAttribute('aria-pressed', 'true');
    await shortcut('i');
    await waitFor(() => expect(viewport().instanceIds).toEqual([key]));
    expect(parts().getByRole('button', { name: 'Hide Shelf 3' })).toHaveAttribute('aria-pressed', 'true');
    expect(parts().getByRole('button', { name: 'Show Shelf' })).toHaveAttribute('aria-pressed', 'false');
    expect(viewport().meshes[0]!.positions).toEqual(original.positions);
    expect(viewport().meshes[0]!.indices).toEqual(original.indices);
    expect(topArea(viewport().meshes[0]!)).toBeCloseTo(215808, 3);
    expect(parts().getByRole('button', { name: 'Shelf 3' })).toHaveAttribute('aria-pressed', 'true');
    await shortcut('i');
    await waitFor(() => expect(viewport().instanceIds).toEqual(shownBefore));
    expect(parts().getByRole('button', { name: 'Show Side' })).toBeTruthy();
    await shortcut('i');
    await shortcut('y');
    await waitFor(() => expect(viewport().instanceIds).toHaveLength(8));
    // Deliberately selecting the source still isolates the unnotched source alone.
    await userEvent.click(parts().getByRole('button', { name: 'Shelf' }));
    await shortcut('i');
    await waitFor(() => expect(viewport().instanceIds).toEqual([shelf.id]));
    expect(topArea(viewport().meshes[0]!)).toBeCloseTo(216408, 3);
    expect(changed).not.toHaveBeenCalled();
    expect(latest()).toEqual(before);
  },
  30_000
);

it('isolates a mirrored standalone copy without changing its identity or mesh', async () => {
  const given = createPlateDocument({ width: 70, height: 40 });
  const part = given.parts[0]!;
  part.copies = [{ id: 'mirror', name: 'Mirrored plate', mirrored: true, offset: { position: [150, 0, 0], rotation: [0, 0, 0, 1] } }];
  const { changed, source } = await studio(given);
  const key = `${part.id}/mirror`;
  const original = viewport().meshes[viewport().instanceIds!.indexOf(key)]!;
  await userEvent.click(parts().getByRole('button', { name: 'Mirrored plate' }));
  await shortcut('i');
  await waitFor(() => expect(viewport().instanceIds).toEqual([key]));
  expect(viewport().meshes[0]!.positions).toEqual(original.positions);
  expect(source.parts[0]!.copies![0]!.id).toBe('mirror');
  expect(changed).not.toHaveBeenCalled();
});

it('does not substitute the source when the selected pattern slot disappears', async () => {
  const { source, latest } = await studio(parseCadDocument(structuredClone(cabinet)));
  await userEvent.click(parts().getByRole('button', { name: 'Shelf 3' }));
  await userEvent.dblClick(within(screen.getByRole('region', { name: 'Features' })).getByRole('button', { name: /^#shelves/ }));
  const dialog = await screen.findByRole('dialog', { name: '#shelves' });
  const value = within(dialog).getByRole('textbox', { name: 'Value' });
  await userEvent.clear(value);
  await userEvent.type(value, '2');
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(parts().queryByRole('button', { name: 'Shelf 3' })).toBeNull());
  await ready();
  const before = structuredClone(latest());
  const shown = [...viewport().instanceIds!];
  const shelf = source.parts.find(part => part.name === 'Shelf')!;
  expect(shown).toContain(shelf.id);
  expect(shown).toContain(`${shelf.id}/${shelf.copies![0]!.id}`);
  await shortcut('i');
  expect(viewport().instanceIds).toEqual(shown);
  expect(latest()).toEqual(before);
}, 30_000);
