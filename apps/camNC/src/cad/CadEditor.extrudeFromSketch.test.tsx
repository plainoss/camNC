import {
  addLine,
  addRectangle,
  CAD_CHORD_TOLERANCE,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  sketchRegions,
  type CadDocument,
} from '@wbcnc/cad';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});

const settled = () =>
  waitFor(() => expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false'), { timeout: 20_000 });

async function openSketch(source: CadDocument) {
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D={false} onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  const dialog = await screen.findByRole('dialog', { name: /^Sketch( · | \d)/ });
  await settled();
  await waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20_000 });
  await waitFor(() => expect(within(dialog).getByRole('button', { name: /Finish sketch/ })).toHaveProperty('disabled', false));
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  canvas.focus();
  return { dialog, canvas, latest: () => change.mock.calls.at(-1)?.[0] ?? source };
}

const extrudeKeys = '{Shift>}E{/Shift}';

it('confirms a sketch not yet extruded with Shift+E and extrudes all of its regions', async () => {
  const shelf = { ...createCadPart('Shelf', 18), drawnOn: { on: { plane: 'top' as const }, offset: 0 }, extrude: false as const };
  shelf.sketch = addRectangle(shelf.sketch, { x: 0, y: 0, width: 100, height: 50 });
  shelf.sketch = addLine(shelf.sketch, { x1: 30, y1: 0, x2: 30, y2: 50 });
  const { latest } = await openSketch({ ...createCadDocument(), parts: [shelf] });
  await userEvent.keyboard(extrudeKeys);
  const extrude = await screen.findByRole('dialog', { name: 'Extrude · Shelf' });
  expect(screen.queryByRole('dialog', { name: /^Sketch( · | \d)/ })).toBeNull();
  // Split in two, the sketch isn't one outline: from the open sketch, it starts with both regions, not none.
  expect(sketchRegions(latest().parts[0]!.sketch, CAD_CHORD_TOLERANCE)).toHaveLength(2);
  await waitFor(() => expect(latest().parts[0]!.regions).toHaveLength(2));
  expect(latest().parts[0]!.extrude).toBeUndefined();
  expect(within(extrude).getByRole('button', { name: 'OK' })).toHaveProperty('disabled', false);
}, 30_000);

it('starts another extrude of an extruded sketch with Shift+E, even with a drawing tool chosen, and cancels back to the sketch', async () => {
  const source = createPlateDocument({ width: 120, height: 80, thickness: 18 });
  const { canvas, latest } = await openSketch(source);
  const plate = latest().parts[0]!;
  await userEvent.keyboard('g');
  await waitFor(() => expect(canvas.classList.contains('cad-tool-rectangle')).toBe(true));
  await userEvent.keyboard(extrudeKeys);
  const extrude = await screen.findByRole('dialog', { name: /^Extrude( · | \d)/ });
  expect(screen.queryByRole('dialog', { name: /^Sketch( · | \d)/ })).toBeNull();
  await waitFor(() => expect(latest().parts).toHaveLength(2));
  const made = latest().parts[1]!;
  expect(made.sketchOf).toBe(plate.id);
  // All of its sketch, as its first extrude has: one outline, not its regions picked one by one.
  expect(made.regions).toBeUndefined();
  await userEvent.click(within(extrude).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(latest().parts).toHaveLength(1));
  expect(latest().parts[0]!.sketch).toEqual(plate.sketch);
  expect(screen.queryByRole('dialog', { name: /^Sketch( · | \d)/ })).toBeNull();
  await screen.findByRole('toolbar', { name: 'Part Studio toolbar' });
}, 30_000);

it('types Shift+E into a dimension being edited instead of extruding', async () => {
  const { dialog } = await openSketch(createPlateDocument({ width: 120, height: 80, thickness: 18 }));
  await userEvent.dblClick(screen.getByRole('button', { name: 'Edit Width: 120 mm' }));
  const input = screen.getByRole('textbox', { name: 'Width mm' });
  await userEvent.fill(input, '#w');
  await userEvent.keyboard(extrudeKeys);
  expect(input).toHaveValue('#wE');
  await settled();
  expect(screen.getByRole('dialog', { name: /^Sketch( · | \d)/ })).toBe(dialog);
  expect(screen.queryByRole('dialog', { name: /^Extrude( · | \d)/ })).toBeNull();
}, 30_000);

it('lists Shift+E in the open sketch’s shortcuts', async () => {
  await openSketch(createPlateDocument({ width: 120, height: 80, thickness: 18 }));
  await userEvent.keyboard('?');
  const list = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
  const section = within(list).getByRole('region', { name: 'Sketch' });
  expect(within(section).getByText('Confirm sketch and extrude it')).toBeDefined();
  expect(within(section).getByText('Shift+E')).toBeDefined();
}, 30_000);
