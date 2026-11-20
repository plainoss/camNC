import { addPoint, createCadDocument, createCadPart, createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { HoleDialog } from './HoleDialog';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { studioCommand } from './studioToolbarTesting';

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});
const settled = () =>
  waitFor(() => expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false'), { timeout: 20_000 });

const boardWithPoints = (withPoints: boolean): CadDocument => {
  const board = { ...createPlateDocument({ width: 100, height: 60 }).parts[0]!, name: 'Board' };
  board.drawnOn = { on: { plane: 'top' }, offset: 0 };
  if (!withPoints) return { ...createCadDocument(), parts: [board] };
  const points = {
    ...createCadPart('Points', 18),
    drawnOn: { on: { partId: board.id, face: 'top' as const }, offset: 0 },
    extrude: false as const,
  };
  points.sketch = addPoint(addPoint(points.sketch, { x: 20, y: 30 }), { x: 80, y: 30 });
  return { ...createCadDocument(), parts: [board, points] };
};

const openWithBoardSelected = async (source: CadDocument) => {
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={change} onFinish={vi.fn()} onCancel={() => {}} />
    </div>
  );
  await settled();
  await userEvent.click(within(screen.getByRole('list', { name: 'Parts' })).getByRole('button', { name: /^▱?\s*Board/ }));
  await userEvent.click(await studioCommand(/^Hole/));
  return () => change.mock.calls.at(-1)?.[0] ?? source;
};

it('makes round holes at the points of a sketch picked from its row', async () => {
  const source = boardWithPoints(true);
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
  await userEvent.click(await studioCommand(/^Hole/));
  // A new Hole starts as a 6 mm drill through the part, its points the selected sketch's.
  const dialog = await screen.findByRole('dialog', { name: '⌀ 6 mm THRU' });
  expect(within(dialog).getAllByText(/^Vertex of Sketch/)).toHaveLength(2);
  expect(within(dialog).getByText('Board')).toBeDefined();
  const diameter = within(dialog).getByRole('textbox', { name: 'Diameter' });
  await userEvent.clear(diameter);
  await userEvent.type(diameter, '8');
  await screen.findByRole('dialog', { name: '⌀ 8 mm THRU' });
  expect(within(dialog).getByRole('note').textContent).toBe('Parameters have been overridden. Check input.');
  await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Termination' }), 'blind');
  await screen.findByRole('dialog', { name: '⌀ 8 mm x 33 mm' });
  expect(within(dialog).getByRole('textbox', { name: 'Tip angle' })).toHaveProperty('value', '118');
  await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Termination' }), 'through');
  // Nothing is drilled until the green check.
  expect(latest().parts[1]).not.toHaveProperty('hole');
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: /^⌀/ })).toBeNull());
  await waitFor(() =>
    expect(latest().parts[0]!.features?.filter(feature => feature.type === 'cut' && feature.depth === 'through')).toHaveLength(2)
  );
  expect(latest().parts[1]).toMatchObject({ hole: { diameter: 8, drillSize: 6, tipAngle: 118 }, remove: { depth: 'through' } });
  expect(latest().parts[0]).not.toHaveProperty('hole');
  expect(within(features).getByRole('button', { name: /⌀ 8 mm THRU/ })).toBeDefined();
});

it('opens a new Hole with nothing picked when a board is selected, and drills nothing', async () => {
  const latest = await openWithBoardSelected(boardWithPoints(true));
  const dialog = await screen.findByRole('dialog', { name: '⌀ 6 mm THRU' });
  expect(within(dialog).queryByText(/^Vertex of/)).toBeNull();
  expect((within(dialog).getByRole('button', { name: 'OK' }) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: /^⌀/ })).toBeNull());
  const [board, points] = latest().parts;
  expect(points).not.toHaveProperty('hole');
  expect(points!.extrude).toBe(false);
  expect(board).not.toHaveProperty('hole');
  expect(board!.features ?? []).toHaveLength(0);
});

it('keeps a counterbore and a countersink from being made until they can be drilled', async () => {
  await openWithBoardSelected(boardWithPoints(true));
  const dialog = await screen.findByRole('dialog', { name: '⌀ 6 mm THRU' });
  await userEvent.click(within(dialog).getByRole('tab', { name: 'Counterbore' }));
  await screen.findByRole('dialog', { name: '⌀ 6 mm THRU | (counterbore)⌀ 12.25 mm x 1 mm' });
  expect(within(dialog).getByRole('textbox', { name: 'Counterbore depth' })).toHaveProperty('value', '1');
  await userEvent.click(within(dialog).getByRole('tab', { name: 'Countersink' }));
  await screen.findByRole('dialog', { name: '⌀ 6 mm THRU | (countersink)⌀ 10 mm x 90°' });
  expect((within(dialog).getByRole('button', { name: 'OK' }) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(within(dialog).getByRole('tab', { name: 'Simple' }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
});

it('never writes a hole onto a board the Hole dialog is opened on', async () => {
  const source = boardWithPoints(false);
  let current = source;
  const onChange = vi.fn((change: (document: CadDocument) => CadDocument) => (current = change(current)));
  render(<HoleDialog document={source} part={source.parts[0]!} onChange={onChange} onOk={vi.fn()} onCancel={vi.fn()} />);
  const dialog = await screen.findByRole('dialog', { name: /^⌀/ });
  expect(within(dialog).getByRole('alert').textContent).toBe('Hole drills at the points of a sketch, not into Board itself.');
  const diameter = within(dialog).getByRole('textbox', { name: 'Diameter' });
  await userEvent.clear(diameter);
  await userEvent.type(diameter, '8');
  await userEvent.tab();
  expect(current.parts[0]).toEqual(source.parts[0]);
  expect((within(dialog).getByRole('button', { name: 'OK' }) as HTMLButtonElement).disabled).toBe(true);
});
