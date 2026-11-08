import {
  addCircle,
  addLine,
  cadSketchRegions,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  setCutDepth,
  type CadDocument,
} from '@wbcnc/cad';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

async function studio() {
  const source = createPlateDocument({ width: 200, height: 100 });
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  const finish = vi.fn<(document: CadDocument) => Promise<void>>(async () => {});
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={change} onFinish={finish} onCancel={() => {}} />
    </div>
  );
  await settled();
  const latest = () => change.mock.calls.at(-1)?.[0] ?? source;
  return { latest, finish };
}

it('opens as a studio, with its own toolbar and steps set in dialogs that keep or drop their changes', async () => {
  const { latest } = await studio();
  const toolbar = await screen.findByRole('toolbar', { name: 'Part Studio toolbar' });
  expect(screen.queryByRole('toolbar', { name: 'Sketch toolbar' })).toBeNull();

  // A changed thickness shows straight away, and the cross puts it back.
  await userEvent.click(within(toolbar).getByRole('button', { name: /Extrude/ }));
  let dialog = await screen.findByRole('dialog', { name: 'Extrude · Plate' });
  const thickness = within(dialog).getByRole('textbox', { name: /Thickness/ });
  await userEvent.clear(thickness);
  await userEvent.type(thickness, '30');
  await userEvent.tab();
  await waitFor(() => expect(latest().parts[0]!.thickness).toBe(30));
  // The design can't be left with a step half set.
  expect(within(toolbar).getByRole('button', { name: /Done/ })).toHaveProperty('disabled', true);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(latest().parts[0]!.thickness).toBe(18));
  expect(screen.queryByRole('dialog', { name: 'Extrude · Plate' })).toBeNull();

  // A thickness that can't be used can't be kept.
  await userEvent.click(within(toolbar).getByRole('button', { name: /Extrude/ }));
  dialog = await screen.findByRole('dialog', { name: 'Extrude · Plate' });
  await userEvent.clear(within(dialog).getByRole('textbox', { name: /Thickness/ }));
  await userEvent.type(within(dialog).getByRole('textbox', { name: /Thickness/ }), '0');
  await userEvent.tab();
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'OK' })).toHaveProperty('disabled', true));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(latest().parts[0]!.thickness).toBe(18);

  // The tick keeps it.
  await userEvent.click(within(toolbar).getByRole('button', { name: /Extrude/ }));
  dialog = screen.getByRole('dialog', { name: 'Extrude · Plate' });
  await userEvent.clear(within(dialog).getByRole('textbox', { name: /Thickness/ }));
  await userEvent.type(within(dialog).getByRole('textbox', { name: /Thickness/ }), '24');
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(latest().parts[0]!.thickness).toBe(24));
  expect(screen.queryByRole('dialog', { name: 'Extrude · Plate' })).toBeNull();

  // A pattern is set in its own dialog.
  await userEvent.click(within(toolbar).getByRole('button', { name: /Pattern/ }));
  dialog = screen.getByRole('dialog', { name: 'Linear pattern · Plate' });
  await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Pattern copies in a row' }));
  await waitFor(() => expect(latest().parts[0]!.copies).toHaveLength(1));
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  expect(latest().parts[0]!.pattern).toBeDefined();
});

it('opens a sketch from its step and closes it back to the studio, cancelling what changed in it', async () => {
  const { latest, finish } = await studio();
  // Double-clicking a feature edits it; for a sketch, that opens it.
  await userEvent.dblClick(within(screen.getByRole('region', { name: 'Features' })).getByRole('button', { name: /Sketch · Plate/ }));
  const sketch = await screen.findByRole('dialog', { name: 'Sketch · Plate' });
  expect(screen.getByRole('toolbar', { name: 'Sketch toolbar' })).toBeDefined();
  // The toolbar has no way out of the design while sketching: the sketch's own dialog closes it.
  expect(screen.queryByRole('button', { name: '✓ Finish sketch' })).toBe(within(sketch).getByRole('button', { name: '✓ Finish sketch' }));
  const before = latest().parts[0]!.sketch;
  await userEvent.keyboard('{Control>}a{/Control}{Delete}');
  await settled();
  expect(latest().parts[0]!.sketch.entities.length).toBeLessThan(before.entities.length);
  await userEvent.click(within(sketch).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(latest().parts[0]!.sketch.entities).toHaveLength(before.entities.length));
  expect(await screen.findByRole('toolbar', { name: 'Part Studio toolbar' })).toBeDefined();
  expect(finish).not.toHaveBeenCalled();
  // Done is what leaves the design.
  await userEvent.click(screen.getByRole('button', { name: /Done/ }));
  await waitFor(() => expect(finish).toHaveBeenCalled());
});

it('lists variables with the steps, edits them in a dialog, and offers a menu on each feature', async () => {
  const { latest } = await studio();
  const toolbar = await screen.findByRole('toolbar', { name: 'Part Studio toolbar' });
  await userEvent.click(within(toolbar).getByRole('button', { name: /Variable/ }));
  let dialog = screen.getByRole('dialog', { name: 'Variable' });
  await userEvent.type(within(dialog).getByRole('textbox', { name: /Name/ }), 'board');
  await userEvent.type(within(dialog).getByRole('textbox', { name: /Value/ }), '19 mm');
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  const features = screen.getByRole('region', { name: 'Features' });
  await waitFor(() => expect([...features.querySelectorAll('ol button')].map(button => button.textContent)[0]).toMatch(/#board = 19 mm/));
  expect(latest().variables?.map(variable => variable.name)).toEqual(['board']);

  // Double-clicking it opens it again.
  await userEvent.dblClick(within(features).getByRole('button', { name: /#board/ }));
  dialog = screen.getByRole('dialog', { name: '#board' });
  await userEvent.clear(within(dialog).getByRole('textbox', { name: /Value/ }));
  await userEvent.type(within(dialog).getByRole('textbox', { name: /Value/ }), '12 mm');
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(within(features).getByRole('button', { name: /#board = 12 mm/ })).toBeDefined());

  // A step's menu renames its part in place, and edits it.
  fireEvent.contextMenu(within(features).getByRole('button', { name: /Extrude · Plate/ }));
  const menu = screen.getByRole('menu');
  expect(
    within(menu)
      .getAllByRole('menuitem')
      .map(item => item.textContent)
  ).toEqual(['Rename', 'Edit…', 'Edit sketch…', 'Suppress', 'Delete']);
  expect(within(menu).getByRole('menuitem', { name: 'Suppress' }).getAttribute('aria-disabled')).toBe('true');
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'Rename' }));
  const name = within(features).getByRole('textbox', { name: 'New name' });
  await userEvent.clear(name);
  await userEvent.type(name, 'Shelf{Enter}');
  await waitFor(() => expect(latest().parts[0]!.name).toBe('Shelf'));
  fireEvent.contextMenu(within(features).getByRole('button', { name: /Extrude · Shelf/ }));
  await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Edit…' }));
  expect(await screen.findByRole('dialog', { name: 'Extrude · Shelf' })).toBeDefined();

  // Deleting the extrude deletes the part, and undo brings it back.
  await userEvent.click(screen.getByRole('dialog', { name: 'Extrude · Shelf' }).querySelector('.cad-feature-cancel')!);
  fireEvent.contextMenu(within(features).getByRole('button', { name: /Extrude · Shelf/ }));
  await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Delete' }));
  await waitFor(() => expect(latest().parts).toHaveLength(0));
  await userEvent.click(within(toolbar).getByRole('button', { name: /^Undo/ }));
  await waitFor(() => expect(latest().parts).toHaveLength(1));
});

it('cancels a new design’s first sketch back to how the design opened', async () => {
  const source = createPlateDocument({ width: 200, height: 100 });
  const change = vi.fn<(document: CadDocument) => void>();
  sessions.push(source.id);
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D="part" onDraftChange={change} onFinish={async () => {}} onCancel={() => {}} />
    </div>
  );
  await settled();
  const sketch = await screen.findByRole('dialog', { name: 'Sketch · Plate' });
  await userEvent.click(screen.getByRole('button', { name: 'Drawing' }));
  await userEvent.keyboard('{Control>}a{/Control}{Delete}');
  await settled();
  await waitFor(() =>
    expect(change.mock.calls.at(-1)?.[0].parts[0]!.sketch.entities.length).toBeLessThan(source.parts[0]!.sketch.entities.length)
  );
  await userEvent.click(within(sketch).getByRole('button', { name: 'Cancel' }));
  await waitFor(() =>
    expect(change.mock.calls.at(-1)?.[0].parts[0]!.sketch.entities).toHaveLength(source.parts[0]!.sketch.entities.length)
  );
});

it('greys out the features after the one being edited, and shows them again once it closes', async () => {
  const source = createPlateDocument({ width: 200, height: 100 });
  source.parts.push({ ...createPlateDocument({ width: 50, height: 50 }).parts[0]!, id: 'top', name: 'Top' });
  sessions.push(source.id);
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={() => {}} onFinish={async () => {}} onCancel={() => {}} />
    </div>
  );
  await settled();
  const features = await screen.findByRole('region', { name: 'Features' });
  const rolledBack = () => [...features.querySelectorAll('.cad-feature-rolled-back')].map(row => row.textContent);
  await userEvent.dblClick(within(features).getByRole('button', { name: /Extrude · Plate/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Extrude · Plate' });
  expect(rolledBack()).toEqual([expect.stringMatching(/Sketch · Top/), expect.stringMatching(/Extrude · Top/)]);
  expect(within(features).getByRole('separator', { name: 'Shown up to here' })).toBeDefined();
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  expect(rolledBack()).toEqual([]);
});

it('says why a variable in use can’t be deleted, and edits a variable from an open sketch in the studio', async () => {
  const source: CadDocument = {
    ...createPlateDocument({ width: 200, height: 100 }),
    variables: [
      { id: 'a', name: 'a', expression: '10 mm' },
      { id: 'b', name: 'b', expression: 'a * 2' },
    ],
  };
  sessions.push(source.id);
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={() => {}} onFinish={async () => {}} onCancel={() => {}} />
    </div>
  );
  await settled();
  const features = await screen.findByRole('region', { name: 'Features' });
  fireEvent.contextMenu(within(features).getByRole('button', { name: /#a = 10 mm/ }));
  await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Delete' }));
  expect((await screen.findByRole('alert')).textContent).toMatch(/a is used in one place/);

  await userEvent.dblClick(within(features).getByRole('button', { name: /Sketch · Plate/ }));
  await screen.findByRole('dialog', { name: 'Sketch · Plate' });
  await userEvent.dblClick(within(features).getByRole('button', { name: /#a = 10 mm/ }));
  expect(await screen.findByRole('dialog', { name: '#a' })).toBeDefined();
  expect(screen.queryByRole('dialog', { name: 'Sketch · Plate' })).toBeNull();
});

it('closes an open variable dialog when another step is started', async () => {
  await studio();
  const toolbar = await screen.findByRole('toolbar', { name: 'Part Studio toolbar' });
  await userEvent.click(within(toolbar).getByRole('button', { name: /Variable/ }));
  expect(screen.getByRole('dialog', { name: 'Variable' })).toBeDefined();
  await userEvent.click(within(toolbar).getByRole('button', { name: /Extrude/ }));
  expect(await screen.findByRole('dialog', { name: 'Extrude · Plate' })).toBeDefined();
  expect(screen.queryByRole('dialog', { name: 'Variable' })).toBeNull();
});

it('keeps steps already set when a cut’s sketch view is cancelled', async () => {
  let source = createPlateDocument({ width: 200, height: 100 });
  const plate = source.parts[0]!;
  plate.sketch = addCircle(plate.sketch, { x: 100, y: 50, radius: 10 });
  const hole = cadSketchRegions(plate, plate.sketch.id).find(region => region.curveIds.length === 1)!;
  source = setCutDepth(source, plate.id, plate.sketch.id, hole.id, 6);
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={change} onFinish={async () => {}} onCancel={() => {}} />
    </div>
  );
  await settled();
  const latest = () => change.mock.calls.at(-1)?.[0] ?? source;
  const features = await screen.findByRole('region', { name: 'Features' });
  await userEvent.dblClick(within(features).getByRole('button', { name: /Extrude · Plate/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Extrude · Plate' });
  await userEvent.clear(within(dialog).getByRole('textbox', { name: /Thickness/ }));
  await userEvent.type(within(dialog).getByRole('textbox', { name: /Thickness/ }), '24');
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(latest().parts[0]!.thickness).toBe(24));
  await userEvent.dblClick(within(features).getByRole('button', { name: /Cut 1 · Plate/ }));
  await userEvent.click(within(await screen.findByRole('dialog', { name: 'Sketch · Plate' })).getByRole('button', { name: 'Cancel' }));
  await screen.findByRole('toolbar', { name: 'Part Studio toolbar' });
  expect(latest().parts[0]!.thickness).toBe(24);
});

it('copies a part with a transform, and edits the copy from its feature', async () => {
  const { latest } = await studio();
  const toolbar = await screen.findByRole('toolbar', { name: 'Part Studio toolbar' });
  await userEvent.click(within(toolbar).getByRole('button', { name: /Transform/ }));
  let dialog = await screen.findByRole('dialog', { name: 'Transform · Plate' });
  const x = within(dialog).getAllByRole('textbox')[0]!;
  await userEvent.clear(x);
  await userEvent.type(x, '250');
  await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Mirror image' }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(latest().parts[0]!.copies?.[0]).toMatchObject({ mirrored: true, offset: { position: [250, 0, 0] } }));
  const features = screen.getByRole('region', { name: 'Features' });
  await userEvent.dblClick(within(features).getByRole('button', { name: /Transform · Plate 2/ }));
  dialog = await screen.findByRole('dialog', { name: 'Transform · Plate' });
  expect(within(dialog).getAllByRole('textbox')[0]).toHaveProperty('value', '250');
  // The copy is a part of its own in the parts list, with its own eye.
  const panel = screen.getByRole('region', { name: 'Parts panel' });
  expect(within(panel).getByRole('heading').textContent).toBe('Parts (2)');
  expect(within(panel).getByRole('button', { name: 'Hide Plate 2' })).toBeDefined();
});

it('opens a new design in the studio, asking for its first sketch’s plane', async () => {
  const source: CadDocument = { ...createCadDocument(), parts: [createCadPart('Part 1')] };
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={change} onFinish={async () => {}} onCancel={() => {}} />
    </div>
  );
  await settled();
  const toolbar = await screen.findByRole('toolbar', { name: 'Part Studio toolbar' });
  expect(
    within(toolbar)
      .getByRole('button', { name: /Sketch/ })
      .getAttribute('aria-pressed')
  ).toBe('true');
  // The blank part isn't a feature until it's sketched; the base planes are listed before the features.
  const features = screen.getByRole('region', { name: 'Features' });
  expect(features.querySelectorAll('ol button')).toHaveLength(0);
  // The sketch waits for its plane, picked in the view or the list.
  const waiting = await screen.findByRole('dialog', { name: 'Sketch' });
  expect(waiting.textContent).toMatch(/Pick a plane or a face/);
  await userEvent.click(within(within(features).getByRole('list', { name: 'Default geometry' })).getByRole('button', { name: /Right/ }));
  const sketch = await screen.findByRole('dialog', { name: 'Sketch · Part 1' });
  expect(sketch.textContent).toMatch(/right plane/);
  await waitFor(() => expect(change.mock.calls.at(-1)?.[0].parts).toHaveLength(1));
  expect(change.mock.calls.at(-1)![0].parts[0]!.drawnOn).toEqual({ on: { plane: 'right' }, offset: 0 });
});

it('sketches on a base plane picked before Sketch or Shift+S, as on one picked after it', async () => {
  const { latest } = await studio();
  const features = await screen.findByRole('region', { name: 'Features' });
  const planes = within(features).getByRole('list', { name: 'Default geometry' });
  // Picking a plane with nothing started only selects it; picking it again lets it go.
  await userEvent.click(within(planes).getByRole('button', { name: /Front/ }));
  expect(within(planes).getByRole('button', { name: /Front/ }).getAttribute('aria-pressed')).toBe('true');
  // The pick is said, so it isn't hidden from whoever presses Sketch next.
  expect(within(screen.getByTestId('workspace-3d')).getByRole('status').textContent).toMatch(/Picked the front plane/i);
  expect(screen.queryByRole('dialog', { name: /Sketch/ })).toBeNull();
  const toolbar = screen.getByRole('toolbar', { name: 'Part Studio toolbar' });
  await userEvent.click(within(toolbar).getByRole('button', { name: /Sketch/ }));
  const sketch = await screen.findByRole('dialog', { name: /^Sketch · / });
  expect(sketch.textContent).toMatch(/front plane/i);
  await waitFor(() => expect(latest().parts.at(-1)!.drawnOn).toEqual({ on: { plane: 'front' }, offset: 0 }));
  // Cancelled, the waiting sketch's cross leaves nothing started.
  await userEvent.click(within(sketch).getByRole('button', { name: 'Cancel' }));
  // Shift+S starts a sketch too: on the plane picked, or waiting for one.
  await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Sketch · / })).toBeNull());
  await userEvent.click(
    within(within(screen.getByRole('region', { name: 'Features' })).getByRole('list', { name: 'Default geometry' })).getByRole('button', {
      name: /Right/,
    })
  );
  await userEvent.keyboard('{Shift>}S{/Shift}');
  const onRight = await screen.findByRole('dialog', { name: /^Sketch · / });
  expect(onRight.textContent).toMatch(/right plane/i);
  await userEvent.click(within(onRight).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Sketch · / })).toBeNull());
  screen.getByTestId('workspace-3d').focus();
  await userEvent.keyboard('{Shift>}S{/Shift}');
  expect(await screen.findByRole('dialog', { name: 'Sketch' })).toBeDefined();
  await userEvent.click(within(screen.getByRole('dialog', { name: 'Sketch' })).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sketch' })).toBeNull());
});

it('makes a variable from `#name = value` in a field and uses it there, and lists variables after `#`', async () => {
  const { latest } = await studio();
  const toolbar = await screen.findByRole('toolbar', { name: 'Part Studio toolbar' });
  await userEvent.click(within(toolbar).getByRole('button', { name: /Extrude/ }));
  let dialog = await screen.findByRole('dialog', { name: 'Extrude · Plate' });
  let thickness = within(dialog).getByRole('textbox', { name: /Thickness/ });
  await userEvent.clear(thickness);
  await userEvent.type(thickness, '#board = 19 mm{Enter}');
  await waitFor(() => expect(latest().variables?.map(variable => [variable.name, variable.expression])).toEqual([['board', '19 mm']]));
  await waitFor(() => expect(latest().parts[0]!.thickness).toBe(19));
  expect(latest().parts[0]!.thicknessExpression).toMatch(/board/);

  // Typing # offers the design's variables, and picking one puts it in the field.
  dialog = await screen.findByRole('dialog', { name: 'Extrude · Plate' }).catch(async () => {
    await userEvent.click(within(toolbar).getByRole('button', { name: /Extrude/ }));
    return screen.findByRole('dialog', { name: 'Extrude · Plate' });
  });
  thickness = within(dialog).getByRole('textbox', { name: /Thickness/ });
  await userEvent.clear(thickness);
  await userEvent.type(thickness, '#bo');
  const options = within(screen.getByRole('listbox', { name: 'Variables' })).getAllByRole('option');
  expect(options.map(option => option.textContent)).toEqual(['#board19 mm', 'New variable']);
  await userEvent.keyboard('{Enter}');
  expect(thickness).toHaveProperty('value', '#board');
});

it('keeps a value typed as `#name = value` when the tick is clicked straight after', async () => {
  const { latest } = await studio();
  const toolbar = await screen.findByRole('toolbar', { name: 'Part Studio toolbar' });
  await userEvent.click(within(toolbar).getByRole('button', { name: /Extrude/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Extrude · Plate' });
  const thickness = within(dialog).getByRole('textbox', { name: /Thickness/ });
  await userEvent.clear(thickness);
  await userEvent.type(thickness, '#board = 19 mm');
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Extrude · Plate' })).toBeNull());
  expect(latest().variables?.map(variable => variable.name)).toEqual(['board']);
  expect(latest().parts[0]!.thickness).toBe(19);
  expect(latest().parts[0]!.thicknessExpression).toMatch(/board/);
});

it('finishes a sketch as a sketch, and extrudes a one-line sketch as a thin board in the Extrude dialog’s Thin tab', async () => {
  const side = { ...createPlateDocument({ width: 130, height: 500, thickness: 20 }).parts[0]!, name: 'Side' };
  side.drawnOn = { on: { plane: 'right' as const }, offset: 0 };
  const back = { ...createCadPart('Back', 4), drawnOn: { on: { partId: side.id, face: 'top' as const }, offset: -10 } };
  back.sketch = addLine(back.sketch, { x1: 10, y1: 0, x2: 10, y2: 500 });
  // A sketch finished but not yet extruded.
  const source: CadDocument = { ...createCadDocument(), parts: [side, { ...back, extrude: false }] };
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={change} onFinish={async () => {}} onCancel={() => {}} />
    </div>
  );
  await settled();
  const latest = () => change.mock.calls.at(-1)?.[0] ?? source;
  const features = await screen.findByRole('region', { name: 'Features' });
  // It's a feature, not a part.
  expect(within(features).queryByRole('button', { name: /Extrude · Back/ })).toBeNull();
  // Nor can it be cut with, or into, while it's a sketch: one part is all there is to cut.
  expect(
    within(screen.getByRole('toolbar', { name: 'Part Studio toolbar' }))
      .getByRole('button', { name: /Cut parts/ })
      .hasAttribute('disabled') ||
      within(screen.getByRole('toolbar', { name: 'Part Studio toolbar' }))
        .getByRole('button', { name: /Cut parts/ })
        .getAttribute('aria-disabled') === 'true'
  ).toBe(true);
  expect(within(screen.getByRole('region', { name: 'Parts panel' })).queryByText('Back')).toBeNull();
  await userEvent.dblClick(within(features).getByRole('button', { name: /Sketch · Back/ }));
  const sketch = await screen.findByRole('dialog', { name: 'Sketch · Back' });
  await waitFor(() => expect(within(sketch).getByRole('button', { name: '✓ Finish sketch' })).toHaveProperty('disabled', false));
  await userEvent.click(within(sketch).getByRole('button', { name: '✓ Finish sketch' }));
  // Finishing opens nothing, as in the reference: Extrude is started with Shift+E or from the toolbar.
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sketch · Back' })).toBeNull());
  expect(screen.queryByRole('dialog', { name: /^Extrude/ })).toBeNull();
  expect(latest().parts[1]!.extrude).toBe(false);
  // Cancelled, Extrude leaves the sketch a sketch.
  await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('workspace-3d')));
  await userEvent.keyboard('{Shift>}E{/Shift}');
  await userEvent.click(within(await screen.findByRole('dialog', { name: 'Extrude · Back' })).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(latest().parts[1]!.extrude).toBe(false));
  await userEvent.click(within(screen.getByRole('toolbar', { name: 'Part Studio toolbar' })).getByRole('button', { name: /Extrude/ }));
  const extrude = await screen.findByRole('dialog', { name: 'Extrude · Back' });
  expect(latest().parts[1]!.extrude).toBeUndefined();
  expect(within(extrude).getByRole('tab', { name: 'Thin' }).getAttribute('aria-selected')).toBe('true');
  const depth = within(extrude).getByRole('textbox', { name: 'Depth' });
  // A depth that can't be taken keeps the dialog open to fix it.
  await userEvent.clear(depth);
  await userEvent.type(depth, '0{Enter}');
  expect(await within(extrude).findByRole('alert')).toBeDefined();
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(screen.getByRole('dialog', { name: 'Extrude · Back' })).toBe(extrude);
  await userEvent.clear(depth);
  await userEvent.type(depth, '380{Enter}');
  await waitFor(() => expect(latest().parts[1]!.thin).toEqual({ depth: 380, midPlane: true }));
  // Enter in a field keeps the step, as the tick does.
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Extrude · Back' })).toBeNull());
  // Solid takes it back to a face pushed out by its thickness.
  await userEvent.dblClick(within(features).getByRole('button', { name: /Extrude · Back/ }));
  await userEvent.click(within(await screen.findByRole('dialog', { name: 'Extrude · Back' })).getByRole('tab', { name: 'Solid' }));
  await waitFor(() => expect(latest().parts[1]!.thin).toBeUndefined());
});

it('lists the parts at the bottom of the sidebar, each with an eye to hide it in the view', async () => {
  await studio();
  const panel = await screen.findByRole('region', { name: 'Parts panel' });
  const sidebar = panel.closest('aside')!;
  // Below the features, as the sidebar's last section.
  expect(sidebar.lastElementChild).toBe(panel);
  const eye = within(panel).getByRole('button', { name: 'Hide Plate' });
  await userEvent.click(eye);
  expect(within(panel).getByRole('button', { name: 'Show Plate' }).getAttribute('aria-pressed')).toBe('false');
  await userEvent.click(within(panel).getByRole('button', { name: 'Show Plate' }));
  expect(within(panel).getByRole('button', { name: 'Hide Plate' })).toBeDefined();
});

it('doesn’t apply a field after its dialog is cancelled, and applies a dimension through its form after #name = value', async () => {
  const { latest } = await studio();
  const toolbar = await screen.findByRole('toolbar', { name: 'Part Studio toolbar' });
  await userEvent.click(within(toolbar).getByRole('button', { name: /Extrude/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Extrude · Plate' });
  const thickness = within(dialog).getByRole('textbox', { name: /Thickness/ });
  await userEvent.clear(thickness);
  await userEvent.type(thickness, '#board = 19 mm');
  // Leaving the field for the cross: the variable is made, but the cancelled step stays as it was.
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await new Promise(resolve => setTimeout(resolve, 200));
  expect(latest().parts[0]!.thickness).toBe(18);

  await userEvent.dblClick(within(screen.getByRole('region', { name: 'Features' })).getByRole('button', { name: /Sketch · Plate/ }));
  await screen.findByRole('dialog', { name: 'Sketch · Plate' });
  await userEvent.dblClick(await screen.findByRole('button', { name: /^Edit Width: 200 mm/ }));
  const width = await screen.findByRole('textbox', { name: /Width/ });
  await userEvent.clear(width);
  await userEvent.type(width, '#span = 150 mm{Enter}');
  await waitFor(() => expect(latest().variables?.find(variable => variable.name === 'span')?.expression).toBe('150 mm'));
  await waitFor(() =>
    expect(latest().parts[0]!.sketch.constraints.find(constraint => constraint.label === 'Width')).toMatchObject({ value: 150 })
  );
});

it('keeps a part drawn on where its sketch is, behind that sketch, when nothing else is drawn on it', async () => {
  const other = { ...createPlateDocument({ width: 50, height: 50, thickness: 20 }).parts[0]!, name: 'Other' };
  other.placement = { position: [1000, 0, 0], rotation: [0, 0, 0, 1] };
  const base = { ...createPlateDocument({ width: 130, height: 500, thickness: 20 }).parts[0]!, id: 'base', name: 'Base' };
  base.drawnOn = { on: { plane: 'top' as const }, offset: 0 };
  const lid = { ...createCadPart('Lid', 4), drawnOn: { on: { partId: base.id, face: 'top' as const }, offset: 0 } };
  lid.sketch = addLine(lid.sketch, { x1: 10, y1: 10, x2: 100, y2: 10 });
  const source: CadDocument = { ...createCadDocument(), parts: [other, base, { ...lid, thin: { depth: 50, midPlane: false } }] };
  sessions.push(source.id);
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={() => {}} onFinish={async () => {}} onCancel={() => {}} />
    </div>
  );
  await settled();
  const features = await screen.findByRole('region', { name: 'Features' });
  await userEvent.dblClick(within(features).getByRole('button', { name: /Sketch · Lid/ }));
  await screen.findByRole('dialog', { name: 'Sketch · Lid' });
  await waitFor(() => expect(document.querySelectorAll('.cad-part-edge').length).toBeGreaterThanOrEqual(4), { timeout: 10_000 });
  // The base's long sides, under the face outline at x 0 and 130, not off in a row beside the other part.
  const xs = [...document.querySelectorAll('.cad-part-edge')]
    .filter(edge => Math.abs(Number(edge.getAttribute('y1')) - Number(edge.getAttribute('y2'))) === 500)
    .map(edge => Number(edge.getAttribute('x1')));
  expect(xs.sort((a, b) => a - b)).toEqual([0, 130]);
});

it('uses an edge of a part behind a sketch in it, fixed where it is, picked then U, or U then clicked', async () => {
  const side = { ...createPlateDocument({ width: 130, height: 500, thickness: 20 }).parts[0]!, name: 'Side' };
  side.drawnOn = { on: { plane: 'right' as const }, offset: 0 };
  const shelf = { ...createCadPart('Shelf', 20), drawnOn: { on: { plane: 'front' as const }, offset: 0 } };
  shelf.sketch = addLine(shelf.sketch, { x1: 20, y1: 200, x2: 380, y2: 200 });
  const source: CadDocument = { ...createCadDocument(), parts: [side, { ...shelf, thin: { depth: 130, midPlane: false } }] };
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={change} onFinish={async () => {}} onCancel={() => {}} />
    </div>
  );
  await settled();
  const latest = () => change.mock.calls.at(-1)?.[0] ?? source;
  const features = await screen.findByRole('region', { name: 'Features' });
  await userEvent.dblClick(within(features).getByRole('button', { name: /Sketch · Shelf/ }));
  await screen.findByRole('dialog', { name: 'Sketch · Shelf' });
  // The side board, seen from the front, is a 20 mm wide strip 500 mm high.
  await waitFor(() => expect(document.querySelectorAll('.cad-part-edge').length).toBeGreaterThanOrEqual(4), { timeout: 10_000 });
  const edges = [...document.querySelectorAll<SVGLineElement>('.cad-part-edge')];
  const tall = edges.find(edge => Math.abs(Number(edge.getAttribute('y1')) - Number(edge.getAttribute('y2'))) === 500)!;
  expect(tall).toBeDefined();
  const lines = () => latest().parts[1]!.sketch.entities.filter(entity => entity.type === 'line').length;
  const before = lines();
  fireEvent.pointerDown(tall, { button: 0, buttons: 1, pointerId: 1, clientX: 0, clientY: 0 });
  fireEvent.pointerUp(tall, { button: 0, pointerId: 1 });
  await waitFor(() => expect(tall.classList.contains('is-picked')).toBe(true));
  await userEvent.keyboard('u');
  await waitFor(() => expect(lines()).toBe(before + 1));
  const sketch = latest().parts[1]!.sketch;
  const used = sketch.entities.at(-1)!;
  expect(used.type).toBe('line');
  const ends = sketch.entities.filter(entity => used.type === 'line' && (entity.id === used.startId || entity.id === used.endId));
  expect(ends.map(end => end.type === 'point' && [Math.abs(end.y), !!end.fixed])).toEqual(
    expect.arrayContaining([
      [0, true],
      [500, true],
    ])
  );
  // Tool first, as the reference teaches: U with nothing picked, then each edge clicked goes in, until Escape.
  await userEvent.keyboard('u');
  await waitFor(() => expect(screen.getByTestId('cad-canvas').classList.contains('cad-using-edges')).toBe(true));
  const other = [...document.querySelectorAll<SVGLineElement>('.cad-part-edge')].find(
    edge => edge !== tall && Math.abs(Number(edge.getAttribute('y1')) - Number(edge.getAttribute('y2'))) === 500
  )!;
  fireEvent.pointerDown(other, { button: 0, buttons: 1, pointerId: 1, clientX: 0, clientY: 0 });
  fireEvent.pointerUp(other, { button: 0, pointerId: 1 });
  await waitFor(() => expect(lines()).toBe(before + 2));
  expect(screen.getByTestId('cad-canvas').classList.contains('cad-using-edges')).toBe(true);
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.getByTestId('cad-canvas').classList.contains('cad-using-edges')).toBe(false));
  // Choosing Select, already the tool, ends it too.
  await userEvent.keyboard('u');
  await waitFor(() => expect(screen.getByTestId('cad-canvas').classList.contains('cad-using-edges')).toBe(true));
  await userEvent.click(screen.getByRole('button', { name: /^Select/ }));
  await waitFor(() => expect(screen.getByTestId('cad-canvas').classList.contains('cad-using-edges')).toBe(false));
  screen.getByTestId('cad-canvas').focus();
  // U again ends it too.
  await userEvent.keyboard('u');
  await waitFor(() => expect(screen.getByTestId('cad-canvas').classList.contains('cad-using-edges')).toBe(true));
  await userEvent.keyboard('u');
  await waitFor(() => expect(screen.getByTestId('cad-canvas').classList.contains('cad-using-edges')).toBe(false));
});

it('shows the parts built before a sketch behind it, seen straight at its plane and turned by a right drag, and none of its own', async () => {
  const side = { ...createPlateDocument({ width: 130, height: 500, thickness: 20 }).parts[0]!, name: 'Side' };
  side.drawnOn = { on: { plane: 'right' as const }, offset: 0 };
  const back = { ...createCadPart('Back', 4), drawnOn: { on: { partId: side.id, face: 'top' as const }, offset: -10 } };
  back.sketch = addLine(back.sketch, { x1: 10, y1: 0, x2: 10, y2: 500 });
  const source: CadDocument = { ...createCadDocument(), parts: [side, { ...back, thin: { depth: 380, midPlane: true } }] };
  sessions.push(source.id);
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={() => {}} onFinish={async () => {}} onCancel={() => {}} />
    </div>
  );
  await settled();
  const features = await screen.findByRole('region', { name: 'Features' });
  expect(document.querySelector('.cad-sketch-backdrop')).toBeNull();
  await userEvent.dblClick(within(features).getByRole('button', { name: /Sketch · Back/ }));
  await screen.findByRole('dialog', { name: 'Sketch · Back' });
  await waitFor(() => expect(document.querySelector('.cad-sketch-backdrop canvas')).not.toBeNull(), { timeout: 10_000 });
  // The drawing stays on top, and the face it's drawn on shows by its outline over the part.
  const canvas = screen.getByTestId('cad-canvas');
  expect(canvas.classList.contains('cad-canvas-over-parts')).toBe(true);
  // A right drag turns the view, drawing and parts together; the camera never turns by itself.
  expect(canvas.hasAttribute('data-sketch-turned')).toBe(false);
  const box = canvas.getBoundingClientRect(),
    at = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  const pointer = (type: string, dx: number, buttons: number) =>
    canvas.dispatchEvent(
      new PointerEvent(type, { bubbles: true, clientX: at.x + dx, clientY: at.y, button: 2, buttons, pointerId: 1, pointerType: 'mouse' })
    );
  pointer('pointerdown', 0, 2);
  for (const dx of [20, 40, 60]) pointer('pointermove', dx, 2);
  pointer('pointerup', 60, 0);
  await waitFor(() => expect(canvas.hasAttribute('data-sketch-turned')).toBe(true));
  expect(canvas.style.transform).toMatch(/^matrix\(/);
  expect(screen.queryByRole('menu')).toBeNull();
  // n looks straight at the plane again, and once more, at its other side.
  canvas.focus();
  await userEvent.keyboard('n');
  await waitFor(() => expect(canvas.hasAttribute('data-sketch-turned')).toBe(false));
  await userEvent.keyboard('n');
  await waitFor(() => expect(canvas.style.transform).toBe('matrix(-1, 0, 0, 1, 0, 0)'));
  // Seen from behind, a middle drag to the right still carries the drawing to the right.
  const viewX = () => Number(canvas.getAttribute('viewBox')!.split(' ')[0]);
  const x0 = viewX();
  const middle = (type: string, dx: number, buttons: number) =>
    canvas.dispatchEvent(
      new PointerEvent(type, { bubbles: true, clientX: at.x + dx, clientY: at.y, button: 1, buttons, pointerId: 1, pointerType: 'mouse' })
    );
  middle('pointerdown', 0, 4);
  middle('pointermove', 50, 4);
  middle('pointerup', 50, 0);
  await waitFor(() => expect(viewX()).toBeGreaterThan(x0));
  await userEvent.click(within(screen.getByRole('dialog', { name: 'Sketch · Back' })).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(document.querySelector('.cad-sketch-backdrop')).toBeNull());
});
