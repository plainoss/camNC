import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { addPartCut, addRectangle, createCadDocument, createCadPart, setPartPattern, type CadDocument } from '@wbcnc/cad';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { afterEach, expect, it, vi } from 'vitest';
import { ModelViewport } from '@/cam/model/ModelViewport';
import { CadEditor } from './CadEditor';

vi.mock('@/cam/model/ModelViewport', { spy: true });
const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});
const settled = () =>
  waitFor(() => expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false'), { timeout: 20_000 });
const props = () => vi.mocked(ModelViewport).mock.calls.at(-1)![0];
/** The meshes the viewport draws as picked, by either of its two highlight inputs. */
const lit = () => {
  const { meshes, selectedIndexes, highlightIds = [] } = props();
  return meshes.flatMap((mesh, index) => (selectedIndexes?.includes(index) || highlightIds.includes(mesh.partId) ? [index] : []));
};
/**
 * Moves the pointer onto a strip outside the editor and waits until no feature row counts as hovered. The pointer stays
 * where the previous test or test file left it, and Chrome enters a row rendered under it without any pointer move, so a
 * test can start with a row already hovered. `userEvent.unhover` is no way out: it moves to the middle of the page.
 */
async function restPointer() {
  await userEvent.hover(screen.getByTestId('pointer-rest'));
  await waitFor(() => expect(props().highlightIds).toBeUndefined());
}

/** A three-shelf pattern with a chase cutting the given copies, by their index among the pattern's copies. */
async function mount(copies: number[]) {
  const chase = createCadPart('Chase', 12),
    shelf = createCadPart('Shelf', 12);
  shelf.sketch = addRectangle(shelf.sketch, { x: 0, y: 0, width: 300, height: 200, dimensioned: true, positioned: true });
  shelf.drawnOn = { on: { plane: 'top' }, offset: 0 };
  chase.sketch = addRectangle(chase.sketch, { x: 20, y: -10, width: 30, height: 220, dimensioned: true, positioned: true });
  chase.drawnOn = { on: { plane: 'top' }, offset: 0 };
  const patterned = setPartPattern({ ...createCadDocument('Copy cut highlight'), parts: [shelf, chase] }, shelf.id, {
    axis: 'z',
    count: 3,
    spacing: 100,
  });
  const targets = copies.map(index => patterned.parts[0]!.copies![index]!.id);
  const design = addPartCut(
    patterned,
    [chase.id],
    targets.map(copy => `${shelf.id}:${copy}`),
    { value: 0 }
  ).document;
  sessions.push(design.id);
  render(
    <>
      <div data-testid="pointer-rest" style={{ height: 24 }} />
      <div style={{ height: 700, display: 'flex' }}>
        <CadEditor
          document={design}
          startIn3D
          onDraftChange={vi.fn<(d: CadDocument) => void>()}
          onFinish={async () => {}}
          onCancel={() => {}}
        />
      </div>
    </>
  );
  await settled();
  await screen.findByTestId('workspace-3d', undefined, { timeout: 15_000 });
  const keys = targets.map(copy => `${shelf.id}/${copy}`);
  await waitFor(() => expect(props().instanceIds).toEqual(expect.arrayContaining(keys)), { timeout: 15_000 });
  await restPointer();
  return {
    indexes: keys.map(key => props().instanceIds!.indexOf(key)).sort((a, b) => a - b),
    chase: { id: chase.id, index: props().instanceIds!.indexOf(chase.id) },
  };
}
const row = (name: RegExp) => within(screen.getByRole('region', { name: 'Features' })).getByRole('button', { name });

it('lights only the targeted copy while its Cut parts row is hovered, and clears it on leaving', async () => {
  const { indexes, chase } = await mount([1]);
  // The studio opens with the first part, the whole shelf family, selected. Select the chase instead, so only the
  // hover can light a shelf.
  act(() => props().onSelect(chase.id, chase.index));
  await waitFor(() => expect(lit()).toEqual([chase.index]));
  await userEvent.hover(row(/^Cut Shelf 3 with Chase/));
  await waitFor(() => expect(lit()).toEqual([chase.index, ...indexes].sort((a, b) => a - b)));
  await restPointer();
  await waitFor(() => expect(lit()).toEqual([chase.index]));
}, 30_000);

it('keeps only the targeted copy lit once its Cut parts row is selected under the pointer', async () => {
  const { indexes } = await mount([1]);
  await userEvent.click(row(/^Cut Shelf 3 with Chase/));
  await waitFor(() => expect(props().selectedIndexes).toEqual(indexes));
  expect(lit()).toEqual(indexes);
}, 30_000);

it('lights every targeted copy, and no others, for a Cut parts row on two copies', async () => {
  const { indexes, chase } = await mount([0, 1]);
  act(() => props().onSelect(chase.id, chase.index));
  await waitFor(() => expect(lit()).toEqual([chase.index]));
  await userEvent.hover(row(/^Cut Shelf 2, Shelf 3 with Chase/));
  await waitFor(() => expect(lit()).toEqual([chase.index, ...indexes].sort((a, b) => a - b)));
  await userEvent.click(row(/^Cut Shelf 2, Shelf 3 with Chase/));
  await restPointer();
  // With the pointer gone, the selection alone still stands for both targets.
  await waitFor(() => expect(props().selectedIndexes).toEqual(indexes));
  expect(lit()).toEqual(indexes);
}, 30_000);
