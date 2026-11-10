import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { createPlateDocument, parseCadDocument, setCadVariable, setPartPattern, type CadDocument, type CadDimension } from '@wbcnc/cad';
import { cadSession, commitCadSession, endCadSession, undoCadSession } from '@wbcnc/cad-editor/session';
import { afterEach, expect, it, vi } from 'vitest';
import cabinet from '../../../../packages/cad-script/fixtures/designs/task-start-cupboard-three-shelves.json';
import { CadEditor } from './CadEditor';
import { solveCadDocument } from './solveCad';
import { ModelViewport } from '@/cam/model/ModelViewport';

vi.mock('@/cam/model/ModelViewport', () => ({ ModelViewport: vi.fn(() => null) }));
const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
  vi.clearAllMocks();
});

const content = (document: CadDocument) => ({ ...document, revision: 0 });
const viewport = () => vi.mocked(ModelViewport).mock.lastCall![0];
async function studio(document: CadDocument, partName: string, priorHistory = false) {
  const source = (await solveCadDocument(document)).document;
  const session = cadSession(source);
  if (priorHistory) {
    commitCadSession(session, { ...session.document, name: 'Earlier edit' });
    commitCadSession(session, { ...session.document, name: 'Later edit' });
    undoCadSession(session);
  }
  sessions.push(source.id);
  const changed = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ width: 1200, height: 800, display: 'flex' }}>
      <CadEditor
        document={session.document}
        editSession={session}
        startIn3D
        onDraftChange={changed}
        onFinish={() => {}}
        onCancel={() => {}}
      />
    </div>
  );
  const settled = () =>
    waitFor(
      () => {
        expect(documentElement()).toHaveAttribute('aria-busy', 'false');
        expect(screen.queryByText(/^Checking sketch/)).toBeNull();
      },
      { timeout: 20_000 }
    );
  await settled();
  const parts = screen.getByRole('list', { name: 'Parts' });
  await userEvent.click(within(parts).getByText(partName, { exact: true }).closest('button')!);
  return {
    source,
    session,
    changed,
    settled,
    latest: () => session.document,
    toolbar: within(screen.getByRole('toolbar', { name: 'Part Studio toolbar' })),
  };
}
const documentElement = () => document.querySelector('.cad-editor')!;

it.each(['new plate', 'complete cabinet', 'new circular plate', 'existing circular plate'] as const)(
  'does not resurrect a canceled pattern from %s with Undo',
  async fixture => {
    const cabinetFixture = fixture === 'complete cabinet';
    let source = cabinetFixture ? parseCadDocument(structuredClone(cabinet)) : createPlateDocument({ width: 200, height: 100 });
    const circular = fixture.includes('circular');
    if (fixture === 'existing circular plate')
      source = setPartPattern(source, source.parts[0]!.id, {
        axis: 'z',
        count: 3,
        spacing: 100,
        circular: { origin: [0, 0, 0], axis: [0, 0, 1], angle: 360 },
      });
    const name = cabinetFixture ? 'Shelf' : 'Plate';
    const { session, toolbar, latest, settled } = await studio(source, name);
    const before = structuredClone(latest());
    expect(session.past).toHaveLength(0);
    await userEvent.click(toolbar.getByRole('button', { name: /Pattern/ }));
    let dialog = await screen.findByRole('dialog', {
      name: `${fixture === 'existing circular plate' ? 'Circular' : 'Linear'} pattern · ${name}`,
    });
    if (fixture === 'new circular plate') {
      await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Pattern type' }), 'circular');
      dialog = await screen.findByRole('dialog', { name: `Circular pattern · ${name}` });
    }
    await userEvent.fill(within(dialog).getByRole('textbox', { name: circular ? 'Instance count' : 'How many' }), '5');
    await userEvent.tab();
    const owner = before.parts.find(part => part.name === name)!.id;
    await waitFor(() => expect(viewport().instanceIds!.filter(id => id === owner || id.startsWith(`${owner}/`))).toHaveLength(5));
    expect(content(latest())).toEqual(content(before));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await settled();
    expect(content(latest())).toEqual(content(before));
    const undo = toolbar.getByRole('button', { name: 'Undo (Ctrl or Command Z)' });
    // A canceled operation must leave no command to undo; exercise an enabled button to catch resurrection of its preview.
    if (!(undo as HTMLButtonElement).disabled) await userEvent.click(undo);
    await settled();
    expect(content(latest())).toEqual(content(before));
    expect(session.past).toHaveLength(0);
    expect(undo).toBeDisabled();
  },
  30_000
);

it.each([
  ['linear', false],
  ['linear', true],
  ['circular', false],
  ['circular', true],
] as const)(
  'accepts one %s pattern operation (existing: %s) and retains its preview identities through Undo and Redo',
  async (mode, existing) => {
    let source = createPlateDocument({ width: 60, height: 40 });
    if (existing)
      source = setPartPattern(source, source.parts[0]!.id, {
        axis: mode === 'linear' ? 'x' : 'z',
        count: 3,
        spacing: 100,
        ...(mode === 'circular' && {
          circular: { origin: [0, 0, 0] as [number, number, number], axis: [0, 0, 1] as [number, number, number], angle: 360 },
        }),
      });
    const { session, toolbar, latest, settled } = await studio(source, 'Plate');
    const before = structuredClone(latest());
    await userEvent.click(toolbar.getByRole('button', { name: /Pattern/ }));
    let dialog = await screen.findByRole('dialog', { name: `${existing && mode === 'circular' ? 'Circular' : 'Linear'} pattern · Plate` });
    if (mode === 'circular' && !existing) {
      await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Pattern type' }), 'circular');
      dialog = await screen.findByRole('dialog', { name: 'Circular pattern · Plate' });
    }
    const field = within(dialog).getByRole('textbox', { name: mode === 'circular' ? 'Instance count' : 'How many' });
    await userEvent.fill(field, '4');
    await userEvent.fill(field, '5');
    await userEvent.tab();
    await waitFor(() => expect(viewport().instanceIds).toHaveLength(5));
    const identities = [...viewport().instanceIds!];
    expect(content(latest())).toEqual(content(before));
    expect(session.past).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
    await settled();
    expect(session.past).toHaveLength(1);
    expect(session.future).toHaveLength(0);
    const accepted = structuredClone(latest());
    expect(accepted.parts[0]!.pattern!.count).toBe(5);
    expect(accepted.parts[0]!.copies).toHaveLength(4);
    await userEvent.click(toolbar.getByRole('button', { name: 'Undo (Ctrl or Command Z)' }));
    await settled();
    expect(content(latest())).toEqual(content(before));
    await userEvent.click(toolbar.getByRole('button', { name: 'Redo (Ctrl or Command Shift Z)' }));
    await settled();
    expect(content(latest())).toEqual(content(accepted));
    await waitFor(() => expect(viewport().instanceIds).toEqual(identities));
  },
  30_000
);

it('keeps prior undo and redo boundaries when an existing pattern edit is canceled or accepted unchanged', async () => {
  let document = createPlateDocument({ width: 60, height: 40 });
  document = setPartPattern(document, document.parts[0]!.id, { axis: 'x', count: 3, spacing: 100 });
  const { session, toolbar, latest, settled } = await studio(document, 'Plate', true);
  const before = structuredClone(latest()),
    past = structuredClone(session.past),
    future = structuredClone(session.future);
  await userEvent.click(toolbar.getByRole('button', { name: /Pattern/ }));
  let dialog = await screen.findByRole('dialog', { name: 'Linear pattern · Plate' });
  await userEvent.fill(within(dialog).getByRole('textbox', { name: 'How many' }), '5');
  await userEvent.tab();
  await waitFor(() => expect(viewport().instanceIds).toHaveLength(5));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await settled();
  expect(content(latest())).toEqual(content(before));
  expect(session.past).toEqual(past);
  expect(session.future).toEqual(future);
  await userEvent.click(toolbar.getByRole('button', { name: /Pattern/ }));
  dialog = await screen.findByRole('dialog', { name: 'Linear pattern · Plate' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await settled();
  expect(session.past).toEqual(past);
  expect(session.future).toEqual(future);
  await userEvent.click(toolbar.getByRole('button', { name: 'Redo (Ctrl or Command Shift Z)' }));
  await settled();
  expect(latest().name).toBe('Later edit');
  await userEvent.click(toolbar.getByRole('button', { name: 'Undo (Ctrl or Command Z)' }));
  await settled();
  expect(content(latest())).toEqual(content(before));
}, 30_000);

it.each(['Cancel', 'OK'] as const)(
  'keeps an inline variable as its own operation when the Pattern uses %s',
  async action => {
    const { session, toolbar, latest, settled } = await studio(createPlateDocument({ width: 60, height: 40 }), 'Plate');
    const before = structuredClone(latest());
    await userEvent.click(toolbar.getByRole('button', { name: /Pattern/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Linear pattern · Plate' });
    await waitFor(() => expect(viewport().instanceIds).toHaveLength(2));
    const identities = [...viewport().instanceIds!];
    await userEvent.click(within(dialog).getByText(/Names of the/));
    await userEvent.fill(within(dialog).getByRole('textbox', { name: 'Name of copy 2' }), 'Second rail');
    await userEvent.fill(within(dialog).getByRole('textbox', { name: /^Spacing/ }), '#pitch = 25mm');
    await userEvent.click(within(dialog).getByRole('textbox', { name: 'How many' }));
    await waitFor(() => expect(latest().variables?.map(variable => [variable.name, variable.expression])).toEqual([['pitch', '25mm']]));
    await settled();
    expect(screen.queryByText(/The design changed while this pattern/)).toBeNull();
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: /^Spacing/ })).toHaveValue('#pitch'));
    expect(latest().parts[0]!.pattern).toBeUndefined();
    expect(latest().parts).toEqual(before.parts);
    expect(session.past).toHaveLength(1);
    await waitFor(() => expect(viewport().instanceIds).toEqual(identities));
    const afterVariable = structuredClone(latest());
    await userEvent.click(within(dialog).getByRole('button', { name: action }));
    await settled();
    expect(latest().variables).toEqual(afterVariable.variables);
    expect(session.past).toHaveLength(action === 'Cancel' ? 1 : 2);
    expect(session.future).toHaveLength(0);
    if (action === 'Cancel') expect(content(latest())).toEqual(content(afterVariable));
    else {
      expect(latest().parts[0]!.pattern).toMatchObject({ spacing: 25, spacingExpression: '#pitch' });
      expect(latest().parts[0]!.copies![0]!.name).toBe('Second rail');
      await userEvent.click(toolbar.getByRole('button', { name: 'Undo (Ctrl or Command Z)' }));
      await settled();
      expect(content(latest())).toEqual(content(afterVariable));
      await userEvent.click(toolbar.getByRole('button', { name: 'Redo (Ctrl or Command Shift Z)' }));
      await settled();
      expect(latest().parts[0]!.pattern).toMatchObject({ spacing: 25, spacingExpression: '#pitch' });
      await waitFor(() => expect(viewport().instanceIds).toEqual(identities));
    }
  },
  30_000
);

it('keeps a pattern usable after an inline variable also resizes its source sketch', async () => {
  const source = createPlateDocument({ width: 60, height: 40 });
  const width = source.parts[0]!.sketch.constraints.find(
    (constraint): constraint is CadDimension => constraint.label === 'Width' && 'value' in constraint
  )!;
  width.expression = '#width';
  const variable = setCadVariable(source, { name: 'width', expression: '60mm' });
  if ('error' in variable) throw new Error(variable.error);
  const { session, toolbar, latest, settled } = await studio(variable.document, 'Plate');
  const before = structuredClone(latest());
  await userEvent.click(toolbar.getByRole('button', { name: /Pattern/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Linear pattern · Plate' });
  await userEvent.fill(within(dialog).getByRole('textbox', { name: /^Spacing/ }), '#width = 80mm');
  await userEvent.click(within(dialog).getByRole('textbox', { name: 'How many' }));
  await waitFor(() => expect(latest().variables?.[0]?.expression).toBe('80mm'));
  await settled();
  expect(latest().parts[0]!.sketch.entities).not.toEqual(before.parts[0]!.sketch.entities);
  expect(screen.queryByText(/The design changed while this pattern/)).toBeNull();
  await waitFor(() => expect(within(dialog).getByRole('textbox', { name: /^Spacing/ })).toHaveValue('#width'));
  expect(within(dialog).getByRole('button', { name: 'OK' })).toBeEnabled();
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await settled();
  expect(latest().parts[0]!.pattern).toMatchObject({ spacing: 80, spacingExpression: '#width' });
  expect(session.past).toHaveLength(2);
  await userEvent.click(toolbar.getByRole('button', { name: 'Undo (Ctrl or Command Z)' }));
  await settled();
  expect(latest().parts[0]!.pattern).toBeUndefined();
  expect(latest().variables?.[0]?.expression).toBe('80mm');
}, 30_000);
