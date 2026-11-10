import {
  addCenterRectangle,
  addRectangle,
  CAD_CHORD_TOLERANCE,
  createCadDocument,
  createCadPart,
  evaluateCadPart,
  parseCadDocument,
  sketchRegions,
  type CadDocument,
} from '@wbcnc/cad';
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

it('confirms a filleted sketch with existing region selections, and retains the edit through undo, redo and reload', async () => {
  const part = createCadPart();
  part.sketch = addRectangle(part.sketch, { x: 0, y: 0, width: 400, height: 500, dimensioned: true, positioned: true });
  for (const y of [100, 250, 400])
    part.sketch = addCenterRectangle(part.sketch, { x: 100, y, width: 80, height: 60, dimensioned: true, positioned: true });
  const regions = sketchRegions(part.sketch, CAD_CHORD_TOLERANCE);
  part.regions = regions.slice(0, 3).map(region => region.id);
  part.drawnOn = { on: { plane: 'front' }, offset: 0 };
  const source = { ...createCadDocument(), parts: [part] };
  const edge = part.sketch.entities.find(entity => entity.type === 'line' && !entity.construction)!;
  if (edge.type !== 'line') throw new Error('missing edge');
  saveCadViewState(source.id, { selectedPartId: part.id, selectedEntityIds: [edge.startId], view: { x: -40, y: -540, w: 480, h: 580 } });
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  const latest = () => change.mock.calls.at(-1)?.[0] ?? source;
  const mount = (document: CadDocument) =>
    render(
      <div style={{ height: 700, display: 'flex' }}>
        <CadEditor document={document} startIn3D={false} onDraftChange={change} onFinish={vi.fn()} onCancel={() => {}} />
      </div>
    );
  mount(source);
  const dialog = await screen.findByRole('dialog', { name: /^Sketch · / });
  await checked();
  const canvas = screen.getByTestId('cad-canvas');
  fireEvent.keyDown(canvas, { key: 'f', shiftKey: true });
  await userEvent.click(screen.getByRole('button', { name: 'Apply fillets' }));
  await checked();
  const confirm = within(dialog).getByRole('button', { name: /Finish sketch/ });
  await waitFor(() => expect(confirm).toBeEnabled());
  expect(evaluateCadPart(latest().parts[0]!).diagnostics).toEqual([]);
  expect(latest().parts[0]!.sketch.entities.filter(entity => entity.type === 'arc')).toHaveLength(1);
  fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true });
  await checked();
  expect(latest().parts[0]!.regions).toEqual(part.regions);
  fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true, shiftKey: true });
  await checked();
  await waitFor(() => expect(confirm).toBeEnabled());
  await userEvent.click(confirm);
  await screen.findByRole('toolbar', { name: 'Part Studio toolbar' });
  const saved = parseCadDocument(JSON.parse(JSON.stringify(latest())));
  cleanup();
  endCadSession(source.id);
  mount(saved);
  const reopened = await screen.findByRole('dialog', { name: /^Sketch · / });
  await checked();
  await waitFor(() => expect(within(reopened).getByRole('button', { name: /Finish sketch/ })).toBeEnabled());
  expect(saved.parts[0]!.sketch.entities.filter(entity => entity.type === 'arc')).toHaveLength(1);
}, 40_000);
