import { addPoint, createCadDocument, createCadPart, createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { CadEditor } from './CadEditor';
import { studioCommand } from './studioToolbarTesting';

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});
const settled = () =>
  waitFor(() => expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false'), { timeout: 20_000 });

it('puts both history stacks back when Hole made a board’s points sketch the hole and is cancelled', async () => {
  const board = { ...createPlateDocument({ width: 100, height: 60, thickness: 18 }).parts[0]!, name: 'Board' };
  board.drawnOn = { on: { plane: 'top' }, offset: 0 };
  const points = {
    ...createCadPart('Points', 18),
    drawnOn: { on: { partId: board.id, face: 'top' as const }, offset: 0 },
    extrude: false as const,
  };
  points.sketch = addPoint(addPoint(points.sketch, { x: 20, y: 30 }), { x: 80, y: 30 });
  const source: CadDocument = { ...createCadDocument(), parts: [board, points] };
  sessions.push(source.id);
  const seen: CadDocument[] = [];
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={value => seen.push(value)} onFinish={vi.fn()} onCancel={() => {}} />
    </div>
  );
  await settled();
  const latest = () => seen.at(-1) ?? source;
  const thickness = () => latest().parts[0]!.thickness;
  const undo = () => screen.getByRole('button', { name: /^Undo/ }) as HTMLButtonElement;
  const redo = () => screen.getByRole('button', { name: /^Redo/ }) as HTMLButtonElement;
  const features = await screen.findByRole('region', { name: 'Features' });
  const commitDepth = async (value: string) => {
    await userEvent.dblClick(within(features).getByRole('button', { name: /^Extrude · Board/ }));
    const dialog = await screen.findByRole('dialog', { name: /^Extrude · Board/ });
    // One input event, so the committed edit is a single undo step and not one per keystroke.
    await userEvent.fill(within(dialog).getByRole('textbox', { name: /Thickness/ }), value);
    await userEvent.keyboard('{Enter}');
    await settled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Extrude · Board/ })).toBeNull());
  };
  // Two committed depths and one undone: something to undo and something to redo before Hole runs.
  await commitDepth('25');
  await commitDepth('30');
  await userEvent.click(undo());
  await waitFor(() => expect(thickness()).toBe(25));
  expect([undo().disabled, redo().disabled]).toEqual([false, false]);

  await userEvent.click(within(screen.getByRole('list', { name: 'Parts' })).getByRole('button', { name: /^▱?\s*Board/ }));
  await userEvent.click(await studioCommand(/^Hole/));
  const dialog = await screen.findByRole('dialog', { name: 'Hole · Points' });
  await waitFor(() => expect(latest().parts[1]).toHaveProperty('hole'));
  await userEvent.fill(within(dialog).getByRole('textbox', { name: 'Diameter' }), '8');
  await userEvent.tab();
  await waitFor(() => expect(latest().parts[1]!.hole).toEqual({ diameter: 8 }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Hole · Points' })).toBeNull());

  // The sketch is unextruded again, and the stacks are as they were: the conversion and the preview are on neither.
  await waitFor(() => expect(latest().parts[1]).not.toHaveProperty('hole'));
  expect(latest().parts[1]).not.toHaveProperty('remove');
  expect(latest().parts[1]!.extrude).toBe(false);
  expect(thickness()).toBe(25);
  expect([undo().disabled, redo().disabled]).toEqual([false, false]);
  seen.length = 0;
  await userEvent.click(undo());
  await waitFor(() => expect(thickness()).toBe(18));
  expect(undo().disabled).toBe(true);
  await userEvent.click(redo());
  await waitFor(() => expect(thickness()).toBe(25));
  await userEvent.click(redo());
  await waitFor(() => expect(thickness()).toBe(30));
  expect(redo().disabled).toBe(true);
  expect(seen.some(document => document.parts.some(part => part.hole))).toBe(false);
}, 60_000);
