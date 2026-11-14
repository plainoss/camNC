import { addRectangle, createCadDocument, createCadPart, evaluateCadPart, polygonArea, type CadDocument, type CadSketch } from '@wbcnc/cad';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { ModelViewport } from '@/cam/model/ModelViewport';
import { CadEditor } from './CadEditor';
import { saveShownState } from './shownState';

vi.mock('@/cam/model/ModelViewport', { spy: true });
const viewport = () => vi.mocked(ModelViewport).mock.calls.at(-1)![0];

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(id => {
    endCadSession(id);
    saveShownState(id, { hiddenParts: [], featureVisibility: {} });
  });
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
  const sketchDialog = await screen.findByRole('dialog', { name: /^Sketch( · | \d)/ });
  await settled();
  await waitFor(() => expect(within(sketchDialog).getByRole('button', { name: /Finish sketch/ })).toHaveProperty('disabled', false));
  (screen.getByTestId('cad-canvas') as unknown as SVGSVGElement).focus();
  await userEvent.keyboard('{Shift>}E{/Shift}');
  const dialog = await screen.findByRole('dialog', { name: 'Extrude 1' });
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
  // The view shows the two parts OK makes.
  await waitFor(() => expect(viewport().instanceIds).toHaveLength(2));
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Extrude 1' })).toBeNull());
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

it('keeps a part hidden in the preview of shapes apart hidden once OK makes it', async () => {
  const { dialog, latest } = await extrudeFromSketch(sketch =>
    addRectangle(addRectangle(sketch, { x: 0, y: 0, width: 60, height: 40 }), { x: 100, y: 0, width: 60, height: 40 })
  );
  await waitFor(() => expect(viewport().instanceIds).toHaveLength(2));
  const [first, made] = viewport().instanceIds!;
  expect(first).toBe(latest().parts[0]!.id);
  // A change during the dialog keeps the preview's parts, under the same ids.
  const depth = within(dialog).getByRole('textbox', { name: 'Thickness' });
  await userEvent.fill(depth, '25');
  await userEvent.tab();
  await waitFor(() => expect(latest().parts[0]!.thickness).toBe(25));
  expect(viewport().instanceIds).toEqual([first, made]);
  viewport().onHover?.(made!, 1);
  fireEvent.keyDown(screen.getByTestId('workspace-3d'), { key: 'y', code: 'KeyY' });
  await waitFor(() => expect(viewport().instanceIds).toEqual([first]));
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Extrude 1' })).toBeNull());
  await waitFor(() => expect(latest().parts.map(part => part.id)).toEqual([first, made]));
  await settled();
  expect(viewport().instanceIds).toEqual([first]);
}, 40_000);
