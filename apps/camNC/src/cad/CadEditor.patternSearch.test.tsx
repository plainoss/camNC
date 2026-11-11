import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { addPartCut, createPlateDocument, parseCadDocument, setPartPattern, updatePartCut, type CadDocument } from '@wbcnc/cad';
import { cadSession, endCadSession } from '@wbcnc/cad-editor/session';
import { afterEach, expect, it, vi } from 'vitest';
import { ModelViewport } from '@/cam/model/ModelViewport';
import { CadEditor } from './CadEditor';
import { solveCadDocument } from './solveCad';
import cabinet from '../../../../packages/cad-script/fixtures/designs/task-start-cupboard-three-shelves.json';
import { studioCommand } from './studioToolbarTesting';

vi.mock('@/cam/model/ModelViewport', () => ({ ModelViewport: vi.fn(() => null) }));
const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
  vi.clearAllMocks();
});

type Kind = 'linear' | 'circular';
const toolbar = () => within(screen.getByRole('toolbar', { name: 'Part Studio toolbar' }));
const viewport = () => vi.mocked(ModelViewport).mock.lastCall![0];
const geometry = () => viewport().meshes.map(mesh => Array.from(mesh.positions));
const content = (document: CadDocument) => ({ ...document, revision: 0 });
const label = (kind: Kind) => `${kind === 'linear' ? 'Linear' : 'Circular'} pattern`;
function plate() {
  const document = createPlateDocument({ width: 60, height: 40 });
  document.parts[0]!.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  return document;
}
async function studio(document = plate()) {
  const source = (await solveCadDocument(document)).document;
  const session = cadSession(source);
  sessions.push(source.id);
  render(
    <div style={{ width: 1200, height: 800, display: 'flex' }}>
      <CadEditor document={source} editSession={session} startIn3D onDraftChange={() => {}} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  const settled = () =>
    waitFor(
      () => {
        expect(window.document.querySelector('.cad-editor')).toHaveAttribute('aria-busy', 'false');
        expect(screen.queryByText(/^Checking sketch/)).toBeNull();
      },
      { timeout: 20_000 }
    );
  await settled();
  return { session, settled, latest: () => session.document };
}
async function search(query: string) {
  await userEvent.click(toolbar().getByRole('button', { name: /Search tools/ }));
  const input = screen.getByRole('combobox', { name: 'Search tools' });
  await userEvent.fill(input, query);
  return input;
}
async function choose(kind: Kind, ctrl = false, partName = 'Plate') {
  const input = await search(kind === 'circular' ? 'CIRCULAR PATTERN' : 'linear pattern');
  expect(screen.getByRole('option', { name: label(kind) })).toBeVisible();
  expect(document.activeElement).toBe(input);
  await userEvent.keyboard(ctrl ? '{Control>}{Enter}{/Control}' : '{Enter}');
  expect(screen.queryByRole('combobox', { name: 'Search tools' })).toBeNull();
  return screen.findByRole('dialog', { name: `${label(kind)} · ${partName}` });
}
const count = (dialog: HTMLElement, kind: Kind) =>
  within(dialog).getByRole('textbox', { name: kind === 'linear' ? 'How many' : 'Instance count' });
function defaults(dialog: HTMLElement, kind: Kind) {
  expect(within(dialog).getByRole('combobox', { name: 'Pattern type' })).toHaveValue(kind);
  expect(count(dialog, kind)).toHaveValue(kind === 'linear' ? '2' : '4');
  if (kind === 'linear') expect(within(dialog).getByRole('textbox', { name: /^Spacing/ })).toHaveValue('100');
  else {
    expect(within(dialog).getByRole('textbox', { name: 'Angle' })).toHaveValue('360');
    expect(within(dialog).getByRole('combobox', { name: 'Axis direction' })).toHaveValue('z');
    expect(within(dialog).getByRole('checkbox', { name: 'Equal spacing' })).toBeChecked();
  }
}

it.each(['linear', 'circular'] as const)(
  'finds a distinct %s entry and matches the generic toolbar defaults without publishing a canceled preview',
  async kind => {
    const { session, latest } = await studio();
    const before = structuredClone(latest());
    expect(toolbar().queryByRole('button', { name: label(kind) })).toBeNull();
    const dialog = await choose(kind, kind === 'circular');
    defaults(dialog, kind);
    await waitFor(() => expect(viewport().instanceIds).toHaveLength(kind === 'linear' ? 2 : 4));
    const preview = geometry();
    expect(content(latest())).toEqual(content(before));
    expect(session.past).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(content(latest())).toEqual(content(before));
    expect(session.past).toHaveLength(0);
    expect(session.future).toHaveLength(0);
    expect(toolbar().getByRole('button', { name: 'Undo (Ctrl or Command Z)' })).toBeDisabled();
    await userEvent.click(await studioCommand('Pattern'));
    let generic = await screen.findByRole('dialog', { name: 'Linear pattern · Plate' });
    if (kind === 'circular') {
      await userEvent.selectOptions(within(generic).getByRole('combobox', { name: 'Pattern type' }), 'circular');
      generic = await screen.findByRole('dialog', { name: 'Circular pattern · Plate' });
    }
    defaults(generic, kind);
    await waitFor(() => expect(geometry()).toEqual(preview));
    await userEvent.click(within(generic).getByRole('button', { name: 'Cancel' }));
    expect(content(latest())).toEqual(content(before));
    expect(session.past).toHaveLength(0);
  },
  30_000
);

it.each(['linear', 'circular'] as const)(
  'accepts a searched %s pattern as one operation and retains its identities through Undo and Redo',
  async kind => {
    const { session, latest, settled } = await studio();
    const before = structuredClone(latest());
    const dialog = await choose(kind);
    await userEvent.fill(count(dialog, kind), '5');
    await userEvent.tab();
    await waitFor(() => expect(viewport().instanceIds).toHaveLength(5));
    const identities = [...viewport().instanceIds!];
    expect(content(latest())).toEqual(content(before));
    expect(session.past).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
    await settled();
    expect(latest().parts[0]!.pattern?.count).toBe(5);
    expect(!!latest().parts[0]!.pattern?.circular).toBe(kind === 'circular');
    expect(session.past).toHaveLength(1);
    await userEvent.click(toolbar().getByRole('button', { name: 'Undo (Ctrl or Command Z)' }));
    await settled();
    expect(content(latest())).toEqual(content(before));
    await userEvent.click(toolbar().getByRole('button', { name: 'Redo (Ctrl or Command Shift Z)' }));
    await settled();
    await waitFor(() => expect(viewport().instanceIds).toEqual(identities));
  },
  30_000
);

it.each(['linear', 'circular'] as const)(
  'preserves an existing %s pattern and uses the established dropdown conversion only for an explicit other-kind entry',
  async kind => {
    let source = plate();
    source = setPartPattern(source, source.parts[0]!.id, {
      axis: 'y',
      count: 3,
      spacing: 37.5,
      ...(kind === 'circular' && {
        circular: {
          origin: [12, 8, 5] as [number, number, number],
          axis: [1, 0, 0] as [number, number, number],
          angle: 120,
          equalSpacing: false,
          opposite: true,
        },
      }),
    });
    const { session, latest } = await studio(source);
    const before = structuredClone(latest());
    const existing = geometry();
    let dialog = await choose(kind);
    expect(count(dialog, kind)).toHaveValue('3');
    await waitFor(() => expect(geometry()).toEqual(existing));
    expect(latest().parts[0]!.pattern).toEqual(before.parts[0]!.pattern);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    dialog = await choose(kind);
    await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
    expect(content(latest())).toEqual(content(before));
    expect(session.past).toHaveLength(0);
    const other: Kind = kind === 'linear' ? 'circular' : 'linear';
    dialog = await choose(other);
    expect(count(dialog, other)).toHaveValue('3');
    await waitFor(() => expect(geometry()).not.toEqual(existing));
    const converted = geometry();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(content(latest())).toEqual(content(before));
    expect(session.past).toHaveLength(0);
    await userEvent.click(await studioCommand('Pattern'));
    dialog = await screen.findByRole('dialog', { name: `${label(kind)} · Plate` });
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Pattern type' }), other);
    dialog = await screen.findByRole('dialog', { name: `${label(other)} · Plate` });
    await waitFor(() => expect(geometry()).toEqual(converted));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(content(latest())).toEqual(content(before));
    expect(session.past).toHaveLength(0);
  },
  30_000
);

it('keeps both pattern search entries disabled for a sketch without an extrusion', async () => {
  const source = plate();
  source.parts[0]!.extrude = false;
  const { session, latest } = await studio(source);
  const before = structuredClone(latest());
  expect(await studioCommand('Pattern')).toHaveAttribute('aria-disabled', 'true');
  // Close the More menu the command may sit in, so typing reaches the tool search.
  if (screen.queryByRole('menu')) await userEvent.keyboard('{Escape}');
  const input = await search('circular pattern');
  expect(screen.queryByRole('option', { name: 'Circular pattern' })).toBeNull();
  expect(screen.getByText('No tools found')).toBeVisible();
  await userEvent.fill(input, 'linear pattern');
  expect(screen.queryByRole('option', { name: 'Linear pattern' })).toBeNull();
  await userEvent.keyboard('{Escape}');
  expect(content(latest())).toEqual(content(before));
  expect(session.past).toHaveLength(0);
});

it('opens the explicit circular controls for the complete cabinet shelf family without publishing its canceled conversion', async () => {
  const { session, latest } = await studio(parseCadDocument(structuredClone(cabinet)));
  await userEvent.click(within(screen.getByRole('list', { name: 'Parts' })).getByRole('button', { name: 'Shelf' }));
  const before = structuredClone(latest());
  const shelf = before.parts.find(part => part.name === 'Shelf')!;
  const identities = [...viewport().instanceIds!];
  const dialog = await choose('circular', false, 'Shelf');
  expect(count(dialog, 'circular')).toHaveValue(shelf.pattern!.countExpression ?? String(shelf.pattern!.count));
  await waitFor(() => expect(viewport().instanceIds).toEqual(identities));
  expect(content(latest())).toEqual(content(before));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(content(latest())).toEqual(content(before));
  expect(session.past).toHaveLength(0);
  expect(session.future).toHaveLength(0);
  await userEvent.click(await studioCommand('Pattern'));
  const generic = await screen.findByRole('dialog', { name: 'Linear pattern · Shelf' });
  expect(count(generic, 'linear')).toHaveValue(shelf.pattern!.countExpression ?? String(shelf.pattern!.count));
  await userEvent.click(within(generic).getByRole('button', { name: 'Cancel' }));
  expect(content(latest())).toEqual(content(before));
}, 30_000);

it.each(['linear', 'circular'] as const)('keeps the selected-copy refusal before initializing a searched %s draft', async kind => {
  let source = plate();
  source = setPartPattern(source, source.parts[0]!.id, { axis: 'x', count: 3, spacing: 100 });
  const { session, latest } = await studio(source);
  const row = within(screen.getByRole('list', { name: 'Parts' })).getByRole('button', { name: 'Plate 2' });
  await userEvent.click(row);
  const before = structuredClone(latest());
  const identities = [...viewport().instanceIds!];
  await search(`${kind} pattern`);
  expect(screen.getByRole('option', { name: label(kind) })).toBeVisible();
  await userEvent.keyboard('{Enter}');
  expect(screen.queryByRole('dialog', { name: /pattern ·/i })).toBeNull();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Patterning only the selected copy is not supported. Select the source part in Parts to pattern its whole family.'
  );
  expect(row).toHaveAttribute('aria-pressed', 'true');
  expect(content(latest())).toEqual(content(before));
  expect(session.past).toHaveLength(0);
  expect(session.future).toHaveLength(0);
  expect(viewport().instanceIds).toEqual(identities);
});

it.each(['linear', 'circular'] as const)(
  'opens a searched %s source-family pattern when a later cut consumes its visible tool body',
  async kind => {
    let source = createPlateDocument({ width: 200, height: 120, thickness: 18 });
    const target = source.parts[0]!;
    target.name = 'Target';
    target.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    const tool = createPlateDocument({ width: 20, height: 20, thickness: 18 }).parts[0]!;
    tool.name = 'Plate';
    tool.placement = { position: [20, 20, 0], rotation: [0, 0, 0, 1] };
    source.parts.push(tool);
    const cut = addPartCut(source, [tool.id], [target.id], { value: 0 });
    source = updatePartCut(cut.document, cut.id, { consumeTools: true });
    const { session, latest, settled } = await studio(source);
    const parts = () => within(screen.getByRole('list', { name: 'Parts' }));
    expect(parts().queryByRole('button', { name: 'Plate' })).toBeNull();
    expect(viewport().instanceIds).not.toContain(tool.id);
    await userEvent.click(
      within(screen.getByRole('region', { name: 'Features' })).getByRole('button', { name: /^Extrude · Plate(?:\s|$)/ })
    );
    const before = structuredClone(latest());
    let dialog = await choose(kind);
    defaults(dialog, kind);
    expect(content(latest())).toEqual(content(before));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(content(latest())).toEqual(content(before));
    expect(session.past).toHaveLength(0);
    dialog = await choose(kind);
    await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
    await settled();
    const accepted = latest().parts.find(part => part.id === tool.id)!.pattern!;
    expect(accepted.count).toBe(kind === 'linear' ? 2 : 4);
    expect(!!accepted.circular).toBe(kind === 'circular');
    expect(latest().partCuts).toEqual(before.partCuts);
    expect(parts().queryByRole('button', { name: 'Plate' })).toBeNull();
    expect(session.past).toHaveLength(1);
    const saved = structuredClone(latest());
    const copyIds = saved.parts.find(part => part.id === tool.id)!.copies!.map(copy => copy.id);
    dialog = await choose(kind);
    defaults(dialog, kind);
    await userEvent.fill(count(dialog, kind), kind === 'linear' ? '3' : '2');
    await userEvent.tab();
    expect(content(latest())).toEqual(content(saved));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(content(latest())).toEqual(content(saved));
    expect(session.past).toHaveLength(1);
    dialog = await choose(kind);
    await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
    expect(latest().parts.find(part => part.id === tool.id)!.pattern!.id).toBe(accepted.id);
    expect(
      latest()
        .parts.find(part => part.id === tool.id)!
        .copies!.map(copy => copy.id)
    ).toEqual(copyIds);
    expect(content(latest())).toEqual(content(saved));
    expect(session.past).toHaveLength(1);
    await userEvent.click(toolbar().getByRole('button', { name: 'Undo (Ctrl or Command Z)' }));
    await settled();
    expect(content(latest())).toEqual(content(before));
  },
  30_000
);
