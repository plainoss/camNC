import { addRectangle, createCadDocument, createCadPart, evaluateCadPart, polygonArea, type CadDocument, type CadSketch } from '@wbcnc/cad';
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
  waitFor(
    () => {
      expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false');
      expect(screen.queryByText(/^Checking sketch/)).toBeNull();
    },
    { timeout: 20_000 }
  );

async function extrudeFromSketch(sketch: (sketch: CadSketch) => CadSketch) {
  const part = { ...createCadPart('Part 1', 18), drawnOn: { on: { plane: 'top' as const }, offset: 0 }, extrude: false as const };
  part.sketch = sketch(part.sketch);
  const source: CadDocument = { ...createCadDocument(), parts: [part] };
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D={false} onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  const sketchDialog = await screen.findByRole('dialog', { name: /^Sketch · / });
  await settled();
  await waitFor(() => expect(within(sketchDialog).getByRole('button', { name: /Finish sketch/ })).toHaveProperty('disabled', false));
  (screen.getByTestId('cad-canvas') as unknown as SVGSVGElement).focus();
  await userEvent.keyboard('{Shift>}E{/Shift}');
  const dialog = await screen.findByRole('dialog', { name: 'Extrude · Part 1' });
  await settled();
  return { dialog, latest: () => change.mock.calls.at(-1)?.[0] ?? source };
}

/** Neither the sketch nor the view says the shapes apart can't be made: OK makes a part of each. */
async function expectNoProblems() {
  await settled();
  expect(screen.queryByText('Finish is blocked')).toBeNull();
  expect(screen.queryByText(/^Not shown:/)).toBeNull();
}

it('extrudes a rectangle and a frame beside it with Shift+E, each a part, the frame keeping its hole', async () => {
  const { dialog, latest } = await extrudeFromSketch(sketch => {
    sketch = addRectangle(sketch, { x: -100, y: 10, width: 60, height: 50 });
    sketch = addRectangle(sketch, { x: 20, y: 0, width: 80, height: 70 });
    return addRectangle(sketch, { x: 35, y: 20, width: 50, height: 30 });
  });
  await waitFor(() => expect(latest().parts[0]!.regions).toHaveLength(2));
  expect(within(dialog).getByRole('button', { name: 'OK' })).toHaveProperty('disabled', false);
  await expectNoProblems();
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Extrude · Part 1' })).toBeNull());
  await waitFor(() => expect(latest().parts).toHaveLength(2));
  const profiles = latest().parts.map(part => evaluateCadPart(part).part!);
  const area = (points: { x: number; y: number }[]) => Math.abs(polygonArea(points));
  expect(profiles.map(profile => area(profile.outline)).sort((a, b) => a - b)).toEqual([3000, 5600]);
  expect(profiles.flatMap(profile => profile.holes.map(area))).toEqual([1500]);
  await expectNoProblems();
}, 40_000);

it('says nothing is blocked while it extrudes two rectangles apart with Shift+E', async () => {
  const { dialog, latest } = await extrudeFromSketch(sketch =>
    addRectangle(addRectangle(sketch, { x: 0, y: 0, width: 60, height: 40 }), { x: 100, y: 0, width: 60, height: 40 })
  );
  await waitFor(() => expect(latest().parts[0]!.regions).toHaveLength(2));
  expect(within(dialog).getByRole('button', { name: 'OK' })).toHaveProperty('disabled', false);
  await expectNoProblems();
}, 40_000);
