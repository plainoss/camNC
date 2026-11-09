import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import {
  addPartCut,
  addRectangle,
  createCadDocument,
  createCadPart,
  evaluateCadDocument,
  setPartPattern,
  type CadDocument,
} from '@wbcnc/cad';
import { afterEach, expect, it, vi } from 'vitest';
import { ModelViewport } from '@/cam/model/ModelViewport';
import { CadEditor } from './CadEditor';
import { endCadSession } from './session';

vi.mock('@/cam/model/ModelViewport', { spy: true });
const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});
const settled = () =>
  waitFor(() => expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false'), { timeout: 20_000 });

function source() {
  const base = createCadPart('Base', 12),
    divider = createCadPart('Divider', 12);
  base.sketch = addRectangle(base.sketch, { x: 0, y: 0, width: 300, height: 200, dimensioned: true, positioned: true });
  base.drawnOn = { on: { plane: 'top' }, offset: 0 };
  divider.sketch = addRectangle(divider.sketch, { x: 20, y: 8, width: 160, height: 72, dimensioned: true, positioned: true });
  divider.drawnOn = { on: { plane: 'right' }, offset: 70 };
  const patterned = setPartPattern(
    {
      ...createCadDocument('Pattern copy tool diagnostic'),
      variables: [{ id: 'divider-count', name: 'dividerCount', expression: '3' }],
      parts: [base, divider],
    },
    divider.id,
    {
      axis: 'x',
      count: 3,
      countExpression: 'dividerCount',
      spacing: 80,
    }
  );
  return addPartCut(patterned, [divider.id], [base.id], { value: 0 }).document;
}
async function mount(document = source()) {
  sessions.push(document.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={document} startIn3D onDraftChange={change} onFinish={async () => {}} onCancel={() => {}} />
    </div>
  );
  await settled();
  const latest = () => change.mock.calls.at(-1)?.[0] ?? document;
  return { latest, document };
}
async function open() {
  const result = await mount();
  await userEvent.dblClick(within(screen.getByRole('region', { name: 'Features' })).getByRole('button', { name: /^Cut Base with / }));
  const dialog = await screen.findByRole('dialog', { name: 'Cut parts' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Take Divider out of tools' }));
  await userEvent.click(within(dialog).getByRole('group', { name: 'Tools' }));
  return { ...result, dialog };
}

it('prefills a new Cut parts step with the exact copy selected before opening the toolbar tool', async () => {
  const document = source();
  delete document.partCuts;
  const { latest } = await mount(document);
  const divider = latest().parts[1]!,
    copy = divider.copies![1]!;
  const row = within(screen.getByRole('list', { name: 'Parts' })).getByRole('button', { name: 'Divider 3' });
  await userEvent.click(row);
  expect(row.getAttribute('aria-pressed')).toBe('true');
  await userEvent.click(within(screen.getByRole('toolbar', { name: 'Part Studio toolbar' })).getByRole('button', { name: /Cut parts/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Cut parts' });
  expect(within(within(dialog).getByRole('group', { name: 'Tools' })).getByText('Divider 3')).toBeDefined();
  await userEvent.click(within(screen.getByRole('list', { name: 'Parts' })).getByRole('button', { name: 'Base' }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cut' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Cut parts' })).toBeNull());
  await settled();
  expect(latest().partCuts![0]!.tools).toEqual([`${divider.id}:${copy.id}`]);
});

it('does not rebind a disappeared preselected copy to its source family', async () => {
  const document = source();
  delete document.partCuts;
  await mount(document);
  await userEvent.click(within(screen.getByRole('list', { name: 'Parts' })).getByRole('button', { name: 'Divider 3' }));
  await userEvent.dblClick(within(screen.getByRole('region', { name: 'Features' })).getByRole('button', { name: /^#dividerCount/ }));
  const variable = await screen.findByRole('dialog', { name: '#dividerCount' });
  const field = within(variable).getByRole('textbox', { name: 'Value' });
  await userEvent.clear(field);
  await userEvent.type(field, '2');
  await userEvent.click(within(variable).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '#dividerCount' })).toBeNull());
  await settled();
  expect(within(screen.getByRole('list', { name: 'Parts' })).queryByRole('button', { name: 'Divider 3' })).toBeNull();
  await userEvent.click(within(screen.getByRole('toolbar', { name: 'Part Studio toolbar' })).getByRole('button', { name: /Cut parts/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Cut parts' });
  expect(within(within(dialog).getByRole('group', { name: 'Tools' })).queryByRole('listitem')).toBeNull();
});

it('cuts with only the third physical divider selected in the Parts list and reopens its saved identity', async () => {
  const { latest, dialog } = await open();
  const divider = latest().parts[1]!,
    copy = divider.copies![1]!;
  await userEvent.click(within(screen.getByRole('list', { name: 'Parts' })).getByRole('button', { name: 'Divider 3' }));
  expect(within(within(dialog).getByRole('group', { name: 'Tools' })).getByText('Divider 3')).toBeDefined();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Cut parts' })).toBeNull());
  await settled();
  expect(latest().partCuts![0]!.tools).toEqual([`${divider.id}:${copy.id}`]);
  const base = evaluateCadDocument(latest()).parts.find(p => p.name === 'Base')!;
  expect(base.cuts).toHaveLength(1);
  // This independently known X interval belongs only to slot3; selecting its
  // source family would also cut at70 and150, despite an unchanged part count.
  expect(base.cuts![0]!.opening).toEqual({ x0: 230, y0: 20, x1: 242, y1: 180 });
  await userEvent.dblClick(within(screen.getByRole('region', { name: 'Features' })).getByRole('button', { name: /^Cut Base with / }));
  expect(within(screen.getByRole('group', { name: 'Tools' })).getByText('Divider 3')).toBeDefined();
});

it('keeps the viewport copy ID and highlights only that tool instance alongside the target', async () => {
  const { latest, dialog } = await open();
  const divider = latest().parts[1]!,
    copy = divider.copies![1]!;
  const props = () => vi.mocked(ModelViewport).mock.calls.at(-1)![0];
  const key = `${divider.id}/${copy.id}`;
  await waitFor(() => expect(props().instanceIds).toContain(key));
  const index = props().instanceIds!.indexOf(key);
  act(() => props().onSelect?.(divider.id, index));
  expect(within(within(dialog).getByRole('group', { name: 'Tools' })).getByText('Divider 3')).toBeDefined();
  await waitFor(() => expect(props().selectedIndexes).toEqual([0, index]));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  await settled();
  expect(latest().partCuts![0]!.tools).toEqual([`${divider.id}:${copy.id}`]);
});
