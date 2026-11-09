import { addPoint, createCadDocument, createCadPart, createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from './session';

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});
const settled = () =>
  waitFor(() => expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false'), { timeout: 20_000 });

it('makes round holes at the points of a sketch on a part’s face', async () => {
  const board = { ...createPlateDocument({ width: 100, height: 60 }).parts[0]!, name: 'Board' };
  board.drawnOn = { on: { plane: 'top' }, offset: 0 };
  const points = {
    ...createCadPart('Points', 18),
    drawnOn: { on: { partId: board.id, face: 'top' as const }, offset: 0 },
    extrude: false as const,
  };
  points.sketch = addPoint(addPoint(points.sketch, { x: 20, y: 30 }), { x: 80, y: 30 });
  const source: CadDocument = { ...createCadDocument(), parts: [board, points] };
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={change} onFinish={vi.fn()} onCancel={() => {}} />
    </div>
  );
  await settled();
  const latest = () => change.mock.calls.at(-1)?.[0] ?? source;
  const features = await screen.findByRole('region', { name: 'Features' });
  await userEvent.click(within(features).getByRole('button', { name: /Sketch · Points/ }));
  await userEvent.click(within(screen.getByRole('toolbar', { name: 'Part Studio toolbar' })).getByRole('button', { name: /^Hole/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Hole · Points' });
  await waitFor(() => expect(latest().parts[1]).toMatchObject({ hole: { diameter: 5 }, remove: { depth: 'through' } }));
  const diameter = within(dialog).getByRole('textbox', { name: 'Diameter' });
  await userEvent.clear(diameter);
  await userEvent.type(diameter, '8{Enter}');
  await waitFor(() => expect(latest().parts[1]!.hole).toEqual({ diameter: 8 }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Hole · Points' })).toBeNull());
  // Two through holes in the board, and the step listed as a hole.
  await waitFor(() =>
    expect(latest().parts[0]!.features?.filter(feature => feature.type === 'cut' && feature.depth === 'through')).toHaveLength(2)
  );
  expect(within(features).getByRole('button', { name: /Hole · Points/ })).toBeDefined();
});
