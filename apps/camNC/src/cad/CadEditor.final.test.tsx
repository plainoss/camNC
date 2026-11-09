import { addPoint, createCadDocument, createCadPart, createPlateDocument, resolveExtrudeSteps, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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

it('shows the whole design with Final while a step before the last is edited', async () => {
  const source = createPlateDocument({ width: 200, height: 100 });
  source.parts.push({ ...createPlateDocument({ width: 50, height: 50 }).parts[0]!, name: 'Second' });
  await studio(source);
  await screen.findByTestId('workspace-3d', undefined, { timeout: 10_000 });
  const props = () => vi.mocked(ModelViewport).mock.calls.at(-1)![0];
  await waitFor(() => expect(props().meshes).toHaveLength(2));
  const features = screen.getByRole('region', { name: 'Features' });
  await userEvent.dblClick(within(features).getByRole('button', { name: /Extrude · Plate/ }));
  const dialog = await screen.findByRole('dialog', { name: /^Extrude/ });
  // Edited, the design shows only as far as this step.
  await waitFor(() => expect(props().meshes).toHaveLength(1));
  const final = within(dialog).getByRole('button', { name: 'Final' });
  await userEvent.click(final);
  await waitFor(() => expect(props().meshes).toHaveLength(2));
  expect(final.getAttribute('aria-pressed')).toBe('true');
  await userEvent.click(final);
  await waitFor(() => expect(props().meshes).toHaveLength(1));
  // The last step has nothing after it to show.
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await userEvent.dblClick(within(features).getByRole('button', { name: /Extrude · Second/ }));
  expect(within(await screen.findByRole('dialog', { name: /^Extrude/ })).queryByRole('button', { name: 'Final' })).toBeNull();
});

it.each([
  ['Transform · Plate', 1],
  ['Transform · Plate 2', 2],
  ['Mirrored copy · Plate 3', 3],
] as const)('rolls back while editing %s and resets Final for the next edit', async (label, count) => {
  const source = createPlateDocument({ width: 200, height: 100 });
  source.parts[0]!.moved = { by: [0, 0, 20] };
  source.parts[0]!.copies = [
    { id: 'translated', offset: { position: [250, 0, 0], rotation: [0, 0, 0, 1] } },
    { id: 'mirrored', mirrored: true, mirror: { across: { plane: 'front' } } },
    { id: 'later-copy', offset: { position: [500, 0, 0], rotation: [0, 0, 0, 1] } },
  ];
  source.parts.push({ ...createPlateDocument({ width: 50, height: 50 }).parts[0]!, name: 'Second' });
  await studio(source);
  await screen.findByTestId('workspace-3d', undefined, { timeout: 10_000 });
  const props = () => vi.mocked(ModelViewport).mock.calls.at(-1)![0];
  await waitFor(() => expect(props().meshes).toHaveLength(5));
  const features = screen.getByRole('region', { name: 'Features' });
  await userEvent.dblClick(within(features).getByRole('button', { name: name => name === label || name.startsWith(`${label} moved`) }));
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => expect(props().meshes).toHaveLength(count));
  const later = within(features).getByRole('button', { name: /Extrude · Second/ });
  expect(later.closest('li')!.classList.contains('cad-feature-rolled-back')).toBe(true);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Final' }));
  await waitFor(() => expect(props().meshes).toHaveLength(5));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(props().meshes).toHaveLength(5));
  await userEvent.dblClick(within(features).getByRole('button', { name: /Extrude · Plate/ }));
  await waitFor(() => expect(props().meshes).toHaveLength(1));
  expect(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Final' })).toHaveAttribute('aria-pressed', 'false');
});

it('rolls back to a Hole feature instead of looking for a pattern', async () => {
  const board = createPlateDocument({ width: 100, height: 60 }).parts[0]!;
  board.drawnOn = { on: { plane: 'top' }, offset: 0 };
  const points = createCadPart('Points', 18);
  points.drawnOn = { on: { partId: board.id, face: 'top' }, offset: 0 };
  points.sketch = addPoint(points.sketch, { x: 20, y: 30 });
  points.hole = { diameter: 8 };
  points.remove = { depth: 'through' };
  const second = { ...createPlateDocument({ width: 50, height: 50 }).parts[0]!, name: 'Second' };
  const source = resolveExtrudeSteps({ ...createCadDocument(), parts: [board, points, second] });
  await studio(source);
  await screen.findByTestId('workspace-3d', undefined, { timeout: 10_000 });
  const props = () => vi.mocked(ModelViewport).mock.calls.at(-1)![0];
  await waitFor(() => expect(props().meshes).toHaveLength(2));
  const features = screen.getByRole('region', { name: 'Features' });
  await userEvent.dblClick(within(features).getByRole('button', { name: /Hole · Points/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Hole · Points' });
  await waitFor(() => expect(props().meshes).toHaveLength(1));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Final' }));
  await waitFor(() => expect(props().meshes).toHaveLength(2));
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(props().meshes).toHaveLength(2));
});

it.each(['Extrude', 'Transform'])('switches directly from %s to an earlier Mirror with its own rollback and Final', async kind => {
  const source = createPlateDocument({ width: 200, height: 100 });
  source.parts[0]!.copies = [{ id: 'mirror', mirrored: true, mirror: { across: { plane: 'front' } } }];
  const second = {
    ...createPlateDocument({ width: 50, height: 50 }).parts[0]!,
    name: 'Second',
    moved: { by: [0, 0, 40] as [number, number, number] },
  };
  source.parts.push(second);
  await studio(source);
  await screen.findByTestId('workspace-3d', undefined, { timeout: 10_000 });
  const props = () => vi.mocked(ModelViewport).mock.calls.at(-1)![0];
  await waitFor(() => expect(props().meshes).toHaveLength(3));
  const features = screen.getByRole('region', { name: 'Features' });
  await userEvent.dblClick(within(features).getByRole('button', { name: new RegExp(`${kind} · Second`) }));
  await screen.findByRole('dialog', { name: new RegExp(`^${kind}`) });
  await userEvent.dblClick(within(features).getByRole('button', { name: /Mirrored copy · Plate 2/ }));
  const mirror = await screen.findByRole('dialog', { name: 'Mirror' });
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  await waitFor(() => expect(props().meshes).toHaveLength(2));
  await userEvent.click(within(mirror).getByRole('button', { name: 'Final' }));
  await waitFor(() => expect(props().meshes).toHaveLength(3));
});
