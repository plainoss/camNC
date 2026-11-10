import {
  cadPartsToCut,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  evaluateCadDocument,
  parseCadDocument,
  type CadDocument,
} from '@wbcnc/cad';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { defaultProvider, rememberAssistantCredentials } from './assistant/keyStore';
import { requestAssistant } from './assistant/provider';

vi.mock('./assistant/provider', { spy: true });
vi.mock('./WorkspaceView', () => ({
  default: ({ document }: { document: CadDocument }) => (
    <div data-testid="workspace-3d" tabIndex={0}>
      {document.name}
    </div>
  ),
}));
const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
  rememberAssistantCredentials(null);
  vi.restoreAllMocks();
});

async function ready() {
  await waitFor(() => expect(document.querySelector('.cad-editor')?.getAttribute('aria-busy')).toBe('false'), { timeout: 30_000 });
}

async function insert(width: number) {
  await userEvent.click(screen.getByText('Insert', { selector: 'summary' }));
  await userEvent.click(screen.getByRole('button', { name: 'Cupboard…' }));
  const dialog = await screen.findByRole('dialog', { name: 'Insert cupboard' });
  const input = within(dialog).getByRole('spinbutton', { name: 'Width (mm)' });
  await userEvent.clear(input);
  await userEvent.type(input, String(width));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Preview cupboard' }));
  const review = await screen.findByRole('dialog', { name: 'Review design change' }, { timeout: 60_000 });
  await userEvent.click(within(review).getByRole('button', { name: 'Apply as one undo step' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Review design change' })).toBeNull());
  await ready();
}

function shelfPieces(document: CadDocument, folderId: string) {
  const shelf = document.parts.find(
    part => part.name === 'Shelf' && document.folders?.find(folder => folder.id === folderId)?.partIds.includes(part.id)
  )!;
  return cadPartsToCut(document, evaluateCadDocument(document).parts).filter(
    entry =>
      entry.names.some(name => name.startsWith('Shelf')) &&
      (entry.part.partId === shelf.id || entry.part.partId.startsWith(`${shelf.id}:copy:`))
  );
}

it('inserts the first cupboard into a fresh studio with its untouched empty Part 1 placeholder', async () => {
  const source = createCadDocument();
  source.parts.push(createCadPart('Part 1'));
  sessions.push(source.id);
  let current = source;
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor
        document={source}
        startIn3D
        onDraftChange={document => {
          current = document;
        }}
        onFinish={async () => {}}
        onCancel={() => {}}
      />
    </div>
  );
  await ready();
  await insert(600);
  await waitFor(() => expect(current.folders).toHaveLength(1));
  expect(current.parts.find(part => part.id === source.parts[0].id)?.sketch.entities).toEqual(source.parts[0].sketch.entities);
  expect(current.folders![0].partIds).toHaveLength(5);
  expect(evaluateCadDocument(current).parts.filter(part => part.name !== 'Part 1')).toHaveLength(5);
}, 120_000);

it('inserts two cupboards, keeps one shelf hole through size/count changes, then reopens and undoes', async () => {
  const source = createPlateDocument();
  sessions.push(source.id);
  let current = source;
  const changed = vi.fn((document: CadDocument) => {
    current = document;
  });
  const mount = (document: CadDocument) =>
    render(
      <div style={{ height: 700, display: 'flex' }}>
        <CadEditor document={document} startIn3D onDraftChange={changed} onFinish={async () => {}} onCancel={() => {}} />
      </div>
    );
  let view = mount(source);
  await ready();
  await insert(600);
  await waitFor(() => expect(current.folders).toHaveLength(1));
  await insert(400);
  await waitFor(() => expect(current.folders).toHaveLength(2));
  const firstId = current.folders![0].id,
    second = current.folders![1];
  const untouched = JSON.stringify(current.parts.filter(part => second.partIds.includes(part.id)));
  expect(current.parts.find(part => part.id === source.parts[0].id)).toEqual(source.parts[0]);

  rememberAssistantCredentials({ config: { ...defaultProvider, model: 'recorded-cupboard', images: false }, key: 'recorded-key' });
  await userEvent.click(screen.getByRole('button', { name: 'Assistant' }));
  const dock = await screen.findByRole('complementary', { name: 'Design assistant' }, { timeout: 20_000 });
  let callNumber = 0;
  const edit = async (message: string, script: string) => {
    const prefix = `cupboard-${++callNumber}`;
    vi.mocked(requestAssistant)
      .mockResolvedValueOnce({ role: 'assistant', text: '', calls: [{ id: `${prefix}-guide`, name: 'cad_script_guide', arguments: {} }] })
      .mockResolvedValueOnce({
        role: 'assistant',
        text: '',
        calls: [{ id: `${prefix}-check`, name: 'check_design', arguments: { source: script } }],
      })
      .mockResolvedValueOnce({ role: 'assistant', text: '', calls: [{ id: `${prefix}-finalize`, name: 'finalize_design', arguments: {} }] })
      .mockResolvedValueOnce({ role: 'assistant', text: 'Proposal: checked the requested cupboard change.' });
    await userEvent.type(within(dock).getByRole('textbox', { name: 'Message' }), message);
    await userEvent.click(within(dock).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(requestAssistant).toHaveBeenCalledTimes(callNumber * 4), { timeout: 60_000 });
    const preview = await within(dock).findByRole('button', { name: 'Preview proposal' }, { timeout: 60_000 });
    await waitFor(() => expect(preview).toHaveProperty('disabled', false));
    await userEvent.click(preview);
    const review = await screen.findByRole('dialog', { name: 'Review design change' });
    await userEvent.click(within(review).getByRole('button', { name: 'Apply as one undo step' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Review design change' })).toBeNull());
    await ready();
  };
  await edit(
    'Cut a cable hole in only the second shelf of the first cupboard.',
    `d => d.existingFolder('Cupboard', d => {
    const shelf = d.existingCopy('Shelf 2');
    const sketch = shelf.sketchOn('top');
    sketch.circle({ at: ['originX + width/2', 'originY + depth - back - 50mm'], d: 60 });
    shelf.cut(sketch.regionAt(d.value('originX + width/2'), d.value('originY + depth - back - 50mm')), { depth: 'through' });
  })`
  );
  const shelf = current.parts.find(part => part.name === 'Shelf' && current.folders![0].partIds.includes(part.id))!;
  const copyId = shelf.copies![0].id;
  expect(shelf.features?.filter(feature => feature.copyId === copyId && feature.type === 'cut')).toHaveLength(1);
  expect(
    shelfPieces(current, firstId)
      .map(entry => [entry.names.length, entry.part.cuts?.filter(cut => cut.through).length ?? 0])
      .sort()
  ).toEqual([
    [1, 1],
    [2, 0],
  ]);

  await edit(
    'Make the first cupboard 680 wide and 350 deep.',
    `d => d.existingFolder('Cupboard', d => { d.variable('width', '680mm'); d.variable('depth', '350mm'); })`
  );
  await edit('Give the first cupboard two shelves.', `d => d.existingFolder('Cupboard', d => d.variable('shelves', '2'))`);
  await edit('Restore its third shelf.', `d => d.existingFolder('Cupboard', d => d.variable('shelves', '3'))`);
  expect(current.parts.find(part => part.id === shelf.id)?.copies?.[0].id).toBe(copyId);
  expect(
    shelfPieces(current, firstId)
      .map(entry => entry.names.length)
      .sort()
  ).toEqual([1, 2]);
  expect(JSON.stringify(current.parts.filter(part => second.partIds.includes(part.id)))).toBe(untouched);

  const saved = parseCadDocument(JSON.parse(JSON.stringify(current)));
  view.unmount();
  view = mount(saved);
  await ready();
  expect(
    shelfPieces(current, firstId)
      .map(entry => [entry.names.length, entry.part.cuts?.filter(cut => cut.through).length ?? 0])
      .sort()
  ).toEqual([
    [1, 1],
    [2, 0],
  ]);
  await userEvent.click(within(screen.getByRole('toolbar', { name: 'Part Studio toolbar' })).getByRole('button', { name: /Undo/ }));
  await waitFor(() =>
    expect(current.variables?.find(variable => variable.folderId === firstId && variable.name === 'shelves')?.expression).toBe('2')
  );
  expect(
    current.parts.find(part => part.id === shelf.id)?.features?.filter(feature => feature.copyId === copyId && feature.type === 'cut')
  ).toHaveLength(1);
  expect(JSON.stringify(current.parts.filter(part => second.partIds.includes(part.id)))).toBe(untouched);
}, 240_000);
