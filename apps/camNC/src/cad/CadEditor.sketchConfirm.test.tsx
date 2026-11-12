import { addRectangle, createCadDocument, createCadPart, sketchRegions, type CadDocument } from '@wbcnc/cad';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { saveCadViewState } from '@wbcnc/cad-editor/viewState';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});
const checked = () => waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20_000 });

/** An extruded plate with construction diagonals ending on its corners, opened on its sketch with `selected` picked. */
async function plate(select: (sketch: CadDocument['parts'][number]['sketch']) => string[]) {
  const part = createCadPart('Plate', 18);
  part.sketch = addRectangle(part.sketch, { x: 0, y: 0, width: 400, height: 300, dimensioned: true, positioned: true });
  part.regions = sketchRegions(part.sketch).map(region => region.id);
  part.drawnOn = { on: { plane: 'top' }, offset: 0 };
  const corners = part.sketch.entities.filter(entity => entity.type === 'line').map(line => (line.type === 'line' ? line.startId : ''));
  part.sketch.entities.push(
    { id: 'diagonal-a', type: 'line', startId: corners[0]!, endId: corners[2]!, construction: true },
    { id: 'diagonal-b', type: 'line', startId: corners[1]!, endId: corners[3]!, construction: true }
  );
  const source = { ...createCadDocument(), parts: [part] };
  saveCadViewState(source.id, {
    selectedPartId: part.id,
    selectedEntityIds: select(part.sketch),
    view: { x: -40, y: -340, w: 480, h: 380 },
  });
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D={false} onDraftChange={change} onFinish={vi.fn()} onCancel={() => {}} />
    </div>
  );
  const dialog = await screen.findByRole('dialog', { name: /^Sketch · / });
  await checked();
  return {
    canvas: screen.getByTestId('cad-canvas'),
    confirm: within(dialog).getByRole('button', { name: /Finish sketch/ }),
    latest: () => change.mock.calls.at(-1)?.[0] ?? source,
  };
}

it('confirms a sketch with a fillet still previewed on a corner its diagonals end on, keeping the fillet', async () => {
  const { canvas, confirm, latest } = await plate(sketch => {
    const line = sketch.entities.find(entity => entity.type === 'line' && !entity.construction);
    return line?.type === 'line' ? [line.startId] : [];
  });
  fireEvent.keyDown(canvas, { key: 'f', shiftKey: true });
  expect(await screen.findByRole('button', { name: 'Apply fillets' })).toBeEnabled();
  await waitFor(() => expect(confirm).toBeEnabled());
  await userEvent.click(confirm);
  await screen.findByRole('toolbar', { name: 'Part Studio toolbar' });
  expect(latest().parts[0]!.sketch.entities.filter(entity => entity.type === 'arc')).toHaveLength(1);
  // The plate's Extrude follows its rounded outline.
  const features = screen.getByRole('region', { name: 'Features' });
  expect(
    within(features)
      .getByRole('button', { name: /Extrude · Plate/ })
      .closest('.cad-feature-broken')
  ).toBeNull();
}, 40_000);

it('confirms a sketch whose edit took away its Extrude’s region, and marks the Extrude broken', async () => {
  const { canvas, confirm, latest } = await plate(sketch => [sketch.entities.find(entity => entity.type === 'line')!.id]);
  fireEvent.keyDown(canvas, { key: 'Delete' });
  await checked();
  await waitFor(() => expect(confirm).toBeEnabled());
  expect(screen.queryByText('Finish is blocked')).toBeNull();
  await userEvent.click(confirm);
  await screen.findByRole('toolbar', { name: 'Part Studio toolbar' });
  expect(latest().parts[0]!.sketch.entities.filter(entity => entity.type === 'line' && !entity.construction)).toHaveLength(3);
  const features = screen.getByRole('region', { name: 'Features' });
  const extrude = within(features).getByRole('button', { name: /Extrude · Plate/ });
  expect(extrude.closest('.cad-feature-broken')).not.toBeNull();
}, 40_000);
