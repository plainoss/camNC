import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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

function source() {
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
  const top = patterned.parts[0]!.copies!.at(-1)!;
  return { document: addPartCut(patterned, [chase.id], [`${shelf.id}:${top.id}`], { value: 0 }).document, shelf, top };
}

it('highlights only the targeted copy while its Cut parts row is hovered and selected', async () => {
  const { document: design, shelf, top } = source();
  sessions.push(design.id);
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor
        document={design}
        startIn3D
        onDraftChange={vi.fn<(d: CadDocument) => void>()}
        onFinish={async () => {}}
        onCancel={() => {}}
      />
    </div>
  );
  await settled();
  const props = () => vi.mocked(ModelViewport).mock.calls.at(-1)![0];
  const key = `${shelf.id}/${top.id}`;
  // The lazily loaded workspace view may take a while to mount its viewport under a loaded browser.
  await waitFor(() => expect(props().instanceIds).toContain(key), { timeout: 20_000 });
  const copyIndex = props().instanceIds!.indexOf(key);
  // The pointer stays on the row after the click, so its hover highlight must name the same single copy.
  await userEvent.click(within(screen.getByRole('region', { name: 'Features' })).getByRole('button', { name: /^Cut Shelf 3 with Chase/ }));
  await waitFor(() => expect(props().selectedIndexes).toEqual([copyIndex]));
  expect(props().highlightIds).toEqual([`${shelf.id}:${top.id}`]);
});
