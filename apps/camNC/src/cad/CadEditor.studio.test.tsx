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
  await waitFor(() =>
    expect(
      within(features)
        .getAllByRole('button')
        .map(button => button.textContent)[0]
    ).toMatch(/#board = 19 mm/)
  );
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
  // The blank part isn't a feature until it's sketched.
  expect(within(screen.getByRole('region', { name: 'Features' })).queryAllByRole('button')).toEqual([]);
  await userEvent.click(await screen.findByRole('button', { name: 'Right plane' }));
  const sketch = await screen.findByRole('dialog', { name: 'Sketch · Part 1' });
  expect(sketch.textContent).toMatch(/right plane/);
  await waitFor(() => expect(change.mock.calls.at(-1)?.[0].parts).toHaveLength(1));
  expect(change.mock.calls.at(-1)![0].parts[0]!.drawnOn).toEqual({ on: { plane: 'right' }, offset: 0 });
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

it('closes a one-line sketch as a thin board, set in the Extrude dialog’s Thin tab', async () => {
  const side = { ...createPlateDocument({ width: 130, height: 500, thickness: 20 }).parts[0]!, name: 'Side' };
  side.drawnOn = { on: { plane: 'right' as const }, offset: 0 };
  const back = { ...createCadPart('Back', 4), drawnOn: { on: { partId: side.id, face: 'top' as const }, offset: -10 } };
  back.sketch = addLine(back.sketch, { x1: 10, y1: 0, x2: 10, y2: 500 });
  const source: CadDocument = { ...createCadDocument(), parts: [side, back] };
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
  await userEvent.dblClick(within(features).getByRole('button', { name: /Sketch · Back/ }));
  const sketch = await screen.findByRole('dialog', { name: 'Sketch · Back' });
  await waitFor(() => expect(within(sketch).getByRole('button', { name: '✓ Finish sketch' })).toHaveProperty('disabled', false));
  await userEvent.click(within(sketch).getByRole('button', { name: '✓ Finish sketch' }));
  const extrude = await screen.findByRole('dialog', { name: 'Extrude · Back' });
  expect(within(extrude).getByRole('tab', { name: 'Thin' }).getAttribute('aria-selected')).toBe('true');
  const depth = within(extrude).getByRole('textbox', { name: 'Depth' });
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
