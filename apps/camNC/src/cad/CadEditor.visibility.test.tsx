import { addRectangle, createCadPart, createPlateDocument, resolveDrawnPlacements, type CadDocument, type CadPart } from '@wbcnc/cad';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { ModelViewport } from '@/cam/model/ModelViewport';

vi.mock('@/cam/model/ModelViewport', { spy: true });

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});
const settled = () =>
  waitFor(() => expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false'), { timeout: 20_000 });

async function studio(source = createPlateDocument({ width: 200, height: 100 })) {
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={change} onFinish={vi.fn()} onCancel={() => {}} />
    </div>
  );
  await settled();
  return { latest: () => change.mock.calls.at(-1)?.[0] ?? source };
}

it('hides and shows sketches, planes and the origin with the eye on their rows, a sketch hiding once extruded', async () => {
  const source = createPlateDocument({ width: 200, height: 100 });
  const sketch = { ...createPlateDocument({ width: 50, height: 50 }).parts[0]!, id: 'drawn', name: 'Drawn', extrude: false as const };
  sketch.drawnOn = { on: { plane: 'top' }, offset: 0 };
  source.parts.push(sketch);
  await studio(source);
  await screen.findByTestId('workspace-3d', undefined, { timeout: 10_000 });
  const props = () => vi.mocked(ModelViewport).mock.calls.at(-1)![0];
  const features = screen.getByRole('region', { name: 'Features' });
  const row = (name: RegExp) => within(features).getByRole('button', { name }).closest('li')!;
  // The extruded plate's sketch is hidden, the one not yet extruded shows.
  await waitFor(() => expect(new Set(props().sketchLines?.map(line => line.partId))).toEqual(new Set(['drawn'])));
  expect(row(/Sketch · Plate/).className).toContain('cad-feature-hidden');
  // Rolled back to just after it, the plate isn't extruded yet, so its sketch shows.
  fireEvent.contextMenu(within(row(/Sketch · Plate/)).getByRole('button', { name: /Sketch · Plate/ }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Roll to here' }));
  await waitFor(() => expect(props().sketchLines?.map(line => line.partId)).toContain(source.parts[0]!.id));
  fireEvent.contextMenu(within(row(/Extrude · Plate/)).getByRole('button', { name: /Extrude · Plate/ }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Roll to end' }));
  await waitFor(() => expect(props().sketchLines?.map(line => line.partId)).not.toContain(source.parts[0]!.id));
  await userEvent.click(within(row(/Sketch · Plate/)).getByRole('button', { name: 'Show' }));
  await waitFor(() => expect(new Set(props().sketchLines?.map(line => line.partId))).toEqual(new Set(['drawn', source.parts[0]!.id])));
  await userEvent.click(within(row(/Sketch · Drawn/)).getByRole('button', { name: 'Hide' }));
  await waitFor(() => expect(props().sketchLines?.map(line => line.partId)).not.toContain('drawn'));

  // The default geometry has the origin first, and each of it can be hidden.
  const geometry = within(features).getByRole('list', { name: 'Default geometry' });
  expect(within(geometry).getAllByRole('listitem')[0]!.textContent).toContain('Origin');
  expect(props().showOrigin).toBe(true);
  await userEvent.click(within(within(geometry).getAllByRole('listitem')[0]!).getByRole('button', { name: 'Hide' }));
  await waitFor(() => expect(props().showOrigin).toBe(false));
  await userEvent.click(
    within(within(geometry).getByRole('button', { name: /Front/ }).closest('li')!).getByRole('button', { name: 'Hide' })
  );
  await waitFor(() => expect(props().planes?.map(plane => plane.label)).toEqual(['Top', 'Right']));
});

it('hides a face sketch once an Extrude adds or removes with it, and shows it rolled back to its sketch', async () => {
  const plate = createPlateDocument({ width: 200, height: 120 });
  const board = plate.parts[0]!;
  const onTop = (id: string, name: string, operation: Partial<CadPart>): CadPart => {
    const part: CadPart = { ...createCadPart(name, 10), id, drawnOn: { on: { partId: board.id, face: 'top' }, offset: 0 }, ...operation };
    part.sketch = addRectangle(part.sketch, { x: 60, y: 35, width: 80, height: 50 });
    return part;
  };
  const source = resolveDrawnPlacements({
    ...plate,
    parts: [board, onTop('pocket', 'Pocket', { remove: { depth: 'through' } }), onTop('boss', 'Boss', { addTo: board.id })],
  }).document;
  await studio(source);
  await screen.findByTestId('workspace-3d', undefined, { timeout: 10_000 });
  const props = () => vi.mocked(ModelViewport).mock.calls.at(-1)![0];
  const features = screen.getByRole('region', { name: 'Features' });
  const row = (name: RegExp) => within(features).getByRole('button', { name }).closest('li')!;
  await waitFor(() => expect(row(/Sketch · Pocket/).className).toContain('cad-feature-hidden'));
  expect(row(/Sketch · Boss/).className).toContain('cad-feature-hidden');
  const lines = () => props().sketchLines?.map(line => line.partId) ?? [];
  expect(lines()).not.toContain('pocket');
  expect(lines()).not.toContain('boss');
  // Rolled back to its sketch, the Remove isn't built yet, so its sketch shows.
  fireEvent.contextMenu(within(row(/Sketch · Pocket/)).getByRole('button', { name: /Sketch · Pocket/ }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Roll to here' }));
  await waitFor(() => expect(lines()).toContain('pocket'));
  expect(row(/Sketch · Pocket/).className).not.toContain('cad-feature-hidden');
});

it.each([
  ['not extruded', { extrude: false as const }],
  ['used by an Extrude Remove', { remove: { depth: 'through' as const } }],
])('leaves a face sketch below the rollback bar out of the view when it is %s', async (_, operation) => {
  const plate = createPlateDocument({ width: 200, height: 120 });
  const board = plate.parts[0]!;
  const face: CadPart = {
    ...createCadPart('Face', 10),
    id: 'face',
    drawnOn: { on: { partId: board.id, face: 'top' }, offset: 0 },
    ...operation,
  };
  face.sketch = addRectangle(face.sketch, { x: 60, y: 35, width: 80, height: 50 });
  await studio(resolveDrawnPlacements({ ...plate, parts: [board, face] }).document);
  await screen.findByTestId('workspace-3d', undefined, { timeout: 10_000 });
  const props = () => vi.mocked(ModelViewport).mock.calls.at(-1)![0];
  const features = screen.getByRole('region', { name: 'Features' });
  const row = (name: RegExp) => within(features).getByRole('button', { name }).closest('li')!;
  const lines = () => props().sketchLines?.map(line => line.partId) ?? [];
  const removed = 'remove' in operation;
  await waitFor(() => expect(lines().includes('face')).toBe(!removed));
  fireEvent.contextMenu(within(row(/Extrude · Plate/)).getByRole('button', { name: /Extrude · Plate/ }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Roll to here' }));
  await waitFor(() => expect(row(/Sketch · Face/).className).toContain('cad-feature-rolled-back'));
  await waitFor(() => expect(lines()).not.toContain('face'));
  expect(within(row(/Sketch · Face/)).queryByRole('button', { name: 'Hide' })).toBeNull();
  // Back at the end, the usual rules: shown until an Extrude uses it.
  fireEvent.contextMenu(within(row(/Sketch · Face/)).getByRole('button', { name: /Sketch · Face/ }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Roll to end' }));
  await waitFor(() => expect(lines().includes('face')).toBe(!removed));
  expect(within(row(/Sketch · Face/)).getByRole('button', { name: removed ? 'Show' : 'Hide' })).toBeDefined();
});

it('searches the studio’s own commands with Alt+C outside a sketch', async () => {
  await studio();
  const workspace = await screen.findByTestId('workspace-3d', undefined, { timeout: 10_000 });
  workspace.focus();
  await userEvent.keyboard('{Alt>}c{/Alt}');
  const search = await screen.findByRole('combobox', { name: 'Search tools' });
  await userEvent.type(search, 'pla');
  const options = within(screen.getByRole('listbox', { name: 'Tools' })).getAllByRole('option');
  expect(options.map(option => option.textContent)).toEqual(['Plane']);
  await userEvent.keyboard('{Enter}');
  expect(await screen.findByRole('dialog', { name: 'Plane' })).toBeDefined();
});

it('shows parts shaded with their edges, and offers shaded only or translucent', async () => {
  await studio();
  await screen.findByTestId('workspace-3d', undefined, { timeout: 10_000 });
  const props = () => vi.mocked(ModelViewport).mock.calls.at(-1)![0];
  await waitFor(() => expect(props().display).toBe('edges'));
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Display' }), 'translucent');
  await waitFor(() => expect(props().display).toBe('translucent'));
});
