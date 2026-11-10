import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { addPartCut, cadPartReference, parseCadDocument, updatePartCut, type CadDocument } from '@wbcnc/cad';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { afterEach, expect, it, vi } from 'vitest';
import { ModelViewport } from '@/cam/model/ModelViewport';
import { CadEditor } from './CadEditor';
import { solveCadDocument } from './solveCad';
import cabinet from '../../../../packages/cad-script/fixtures/designs/cabinet-copy-target-start.json';

vi.mock('@/cam/model/ModelViewport', { spy: true });
let session: string | undefined;
afterEach(() => {
  cleanup();
  if (session) endCadSession(session);
  session = undefined;
});

it('edits an earlier exact shelf cut after the complete cabinet consumes that shelf family later', async () => {
  let source = parseCadDocument(structuredClone(cabinet));
  expect(source.parts.map(part => part.name)).toEqual(['Side', 'Bottom', 'Top', 'Back', 'Shelf', 'Cable chase']);
  const shelf = source.parts.find(part => part.name === 'Shelf')!,
    side = source.parts.find(part => part.name === 'Side')!;
  const tool = source.parts.find(part => part.name === 'Cable chase')!;
  const target = cadPartReference(shelf.id, shelf.copies![1]!.id);
  const earlier = addPartCut(source, [tool.id], [target], { value: 0 });
  const later = addPartCut(earlier.document, [shelf.id], [side.id], { value: 0 });
  source = (await solveCadDocument(updatePartCut(later.document, later.id, { consumeTools: true }))).document;
  session = source.id;
  vi.mocked(ModelViewport).mockClear();
  const changed = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={changed} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  const latest = () => changed.mock.calls.at(-1)?.[0] ?? source;
  const viewport = () => vi.mocked(ModelViewport).mock.calls.at(-1)![0];
  await screen.findByTestId('workspace-3d', {}, { timeout: 20_000 });
  await waitFor(() => expect(document.querySelector('.cad-editor')).toHaveAttribute('aria-busy', 'false'), { timeout: 20_000 });
  await waitFor(() => expect(viewport().instanceIds).toContain(side.id));
  // The opening solver can publish after the viewport is visible and aria-busy has cleared.
  await waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20_000 });
  const before = structuredClone(latest()),
    membership = [...viewport().instanceIds!];
  expect(within(screen.getByRole('list', { name: 'Parts' })).queryByRole('button', { name: 'Shelf 3' })).toBeNull();
  await userEvent.dblClick(
    within(screen.getByRole('region', { name: 'Features' })).getByRole('button', { name: /^Cut Shelf 3 with Cable chase/ })
  );
  const dialog = await screen.findByRole('dialog', { name: 'Cut parts' });
  expect(within(within(dialog).getByRole('group', { name: 'Targets' })).getByText('Shelf 3')).toBeDefined();
  const clearance = within(dialog).getByRole('textbox', { name: 'Clearance' });
  await userEvent.clear(clearance);
  await userEvent.type(clearance, '0.4');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  expect(within(dialog).queryByRole('alert')).toBeNull();
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Cut parts' })).toBeNull());
  await waitFor(() => expect(latest().partCuts!.find(step => step.id === earlier.id)?.clearance).toBe(0.4));
  expect(latest().partCuts!.find(step => step.id === earlier.id)?.targets).toEqual([target]);
  expect(latest().partCuts!.filter(step => step.id !== earlier.id)).toEqual(before.partCuts!.filter(step => step.id !== earlier.id));
  expect(latest().parts).toEqual(before.parts);
  await waitFor(() => expect(document.querySelector('.cad-editor')).toHaveAttribute('aria-busy', 'false'));
  await waitFor(() => expect(viewport().instanceIds).toEqual(membership));
}, 40_000);
