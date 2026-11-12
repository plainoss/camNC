import { addPoint, createCadDocument, createCadPart, createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { studioCommand } from './studioToolbarTesting';

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});
const settled = () =>
  waitFor(() => expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false'), { timeout: 20_000 });

it('finishes a sketch of only points on a board’s face, and Hole drills at them', async () => {
  const board = { ...createPlateDocument({ width: 200, height: 100 }).parts[0]!, name: 'Board' };
  board.drawnOn = { on: { plane: 'top' }, offset: 0 };
  const points = {
    ...createCadPart('Points', 18),
    drawnOn: { on: { partId: board.id, face: 'top' as const }, offset: 0 },
    extrude: false as const,
  };
  points.sketch = addPoint(addPoint(points.sketch, { x: 40, y: 50 }), { x: 160, y: 50 });
  const source: CadDocument = { ...createCadDocument(), parts: [board, points] };
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={change} onFinish={vi.fn()} onCancel={() => {}} onEditFaceSketch={vi.fn()} />
    </div>
  );
  await settled();
  const latest = () => change.mock.calls.at(-1)?.[0] ?? source;
  const features = await screen.findByRole('region', { name: 'Features' });
  await userEvent.dblClick(within(features).getByRole('button', { name: /Sketch · Points/ }));
  await settled();
  // The sketch is already on a face, and its points are what it holds: not empty, and nothing to close first.
  expect(screen.queryByText('Close the outline before sketching on a face.')).toBeNull();
  const finish = screen.getByRole('button', { name: '✓ Finish sketch' });
  await waitFor(() => expect(finish.hasAttribute('disabled')).toBe(false), { timeout: 10_000 });
  expect(document.querySelector('.cad-status')!.textContent).toContain('4 degrees of freedom');
  await userEvent.click(finish);
  await settled();
  expect(screen.queryByRole('button', { name: '✓ Finish sketch' })).toBeNull();
  expect(latest().parts[1]).toMatchObject({ extrude: false });
  await userEvent.click(within(features).getByRole('button', { name: /Sketch · Points/ }));
  await userEvent.click(await studioCommand(/^Hole/));
  const dialog = await screen.findByRole('dialog', { name: 'Hole · Points' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() =>
    expect(latest().parts[0]!.features?.filter(feature => feature.type === 'cut' && feature.depth === 'through')).toHaveLength(2)
  );
});
