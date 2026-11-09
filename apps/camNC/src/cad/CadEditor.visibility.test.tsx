import { createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from './session';
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
