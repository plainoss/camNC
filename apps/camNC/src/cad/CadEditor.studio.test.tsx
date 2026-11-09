import {
  sketchRegions,
  CAD_CHORD_TOLERANCE,
  addRectangle,
  addPartCopy,
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
import { ModelViewport } from '@/cam/model/ModelViewport';

vi.mock('@/cam/model/ModelViewport', { spy: true });

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});
/** Opens a part's extrude from its step in the feature list, as the reference edits a feature. */
const editExtrude = async (part: string) =>
  userEvent.dblClick(
    within(await screen.findByRole('region', { name: 'Features' })).getByRole('button', { name: new RegExp(`Extrude · ${part}`) })
  );
const settled = () =>
  waitFor(() => expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false'), { timeout: 20_000 });

async function studio(source = createPlateDocument({ width: 200, height: 100 })) {
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

it('toggles base planes and requests named views and fit from workspace shortcuts', async () => {
  await studio();
  // The 3D workspace loads lazily, which can take longer than the default wait on a busy runner.
  const workspace = await screen.findByTestId('workspace-3d', undefined, { timeout: 10_000 });
  const props = () => vi.mocked(ModelViewport).mock.calls.at(-1)![0];
  await waitFor(() => expect(props().planes).toHaveLength(3));
  fireEvent.keyDown(workspace, { key: 'p', code: 'KeyP' });
  await waitFor(() => expect(props().planes).toBeUndefined());
  fireEvent.keyDown(workspace, { key: 'p', code: 'KeyP' });
  await waitFor(() => expect(props().planes).toHaveLength(3));
  // The physical digit works even on a layout whose shifted key isn't "5".
  fireEvent.keyDown(workspace, { key: '%', code: 'Digit5', shiftKey: true });
  await waitFor(() => expect(props().viewRequest).toEqual({ name: 'top', seq: 1 }));
  fireEvent.keyDown(workspace, { key: 'f', code: 'KeyF' });
  await waitFor(() => expect(props().viewRequest).toEqual({ name: 'fit', seq: 2 }));
  fireEvent.keyDown(workspace, { key: 'f', code: 'KeyF' });
  await waitFor(() => expect(props().viewRequest).toEqual({ name: 'fit', seq: 3 }));
  await userEvent.click(within(screen.getByRole('toolbar', { name: 'Part Studio toolbar' })).getByRole('button', { name: /Sketch/ }));
  await screen.findByRole('dialog', { name: 'Sketch' });
  fireEvent.keyDown(workspace, { key: 'Escape', code: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sketch' })).toBeNull());
});

it('looks straight at the selected part’s sketch plane with N, and from behind with N again, and colours parts as the reference does', async () => {
  await studio();
  const workspace = await screen.findByTestId('workspace-3d');
  const props = () => vi.mocked(ModelViewport).mock.calls.at(-1)![0];
  await waitFor(() => expect(props().palette).toBe('studio'));
  // Overlaps aren't coloured in the studio.
  expect(props().warnIds).toBeUndefined();
  fireEvent.keyDown(workspace, { key: 'n', code: 'KeyN' });
  await waitFor(() => expect(props().viewRequest).toMatchObject({ name: 'normal', direction: [0, 0, 1], up: [0, 1, 0] }));
  fireEvent.keyDown(workspace, { key: 'n', code: 'KeyN' });
  await waitFor(() => expect(props().viewRequest).toMatchObject({ name: 'normal', direction: [-0, -0, -1] }));
  // Hovering a feature row highlights its part.
  const features = screen.getByRole('region', { name: 'Features' });
  fireEvent.pointerEnter(within(features).getByRole('button', { name: /Extrude · Plate/ }));
  await waitFor(() => expect(props().highlightIds).toHaveLength(1));
  fireEvent.pointerLeave(within(features).getByRole('button', { name: /Extrude · Plate/ }));
  await waitFor(() => expect(props().highlightIds).toBeUndefined());
});

it('deletes a feature with the Delete key, as the reference does, and undo brings it back', async () => {
  const { latest } = await studio();
  const features = await screen.findByRole('region', { name: 'Features' });
  const row = within(features).getByRole('button', { name: /Extrude · Plate/ });
  row.focus();
  await userEvent.keyboard('{Delete}');
  await waitFor(() => expect(latest().parts).toHaveLength(0));
  await userEvent.keyboard('{Control>}z{/Control}');
  await waitFor(() => expect(latest().parts).toHaveLength(1));
});

it('routes cube requests through the studio sequence', async () => {
  await studio();
  const workspace = await screen.findByTestId('workspace-3d', undefined, { timeout: 10_000 });
  const props = () => vi.mocked(ModelViewport).mock.calls.at(-1)![0];
  await waitFor(() => expect(props().onViewRequest).toBeDefined());
  props().onViewRequest!({ name: 'top' });
  await waitFor(() => expect(props().viewRequest).toEqual({ name: 'top', seq: 1 }));
  props().onViewRequest!({ name: 'iso', direction: [1, -1, 0] });
  await waitFor(() => expect(props().viewRequest).toEqual({ name: 'iso', direction: [1, -1, 0], seq: 2 }));
  fireEvent.keyDown(workspace, { key: 'f', code: 'KeyF' });
  await waitFor(() => expect(props().viewRequest).toEqual({ name: 'fit', seq: 3 }));
});

it('leaves viewport shortcuts alone while typing in fields or using modifiers', async () => {
  await studio();
  const workspace = await screen.findByTestId('workspace-3d', undefined, { timeout: 10_000 });
  const props = () => vi.mocked(ModelViewport).mock.calls.at(-1)![0];
  await waitFor(() => expect(props().planes).toHaveLength(3));
  for (const field of [document.createElement('input'), document.createElement('textarea'), document.createElement('div')]) {
    if (field instanceof HTMLDivElement) field.contentEditable = 'true';
    workspace.append(field);
    fireEvent.keyDown(field, { key: 'p', code: 'KeyP' });
    fireEvent.keyDown(field, { key: 'f', code: 'KeyF' });
    fireEvent.keyDown(field, { key: '%', code: 'Digit5', shiftKey: true });
    field.remove();
  }
  fireEvent.keyDown(workspace, { key: 'p', code: 'KeyP', ctrlKey: true });
  fireEvent.keyDown(workspace, { key: '%', code: 'Digit5', shiftKey: true, altKey: true });
  expect(props().planes).toHaveLength(3);
  expect(props().viewRequest).toBeUndefined();
});

async function visibilityStudio() {
  let source = createPlateDocument({ width: 200, height: 100 });
  source.parts.push({ ...createPlateDocument({ width: 50, height: 50 }).parts[0]!, id: 'shelf', name: 'Shelf' });
  source = addPartCopy(source, source.parts[0]!.id).document;
  await studio(source);
  const workspace = await screen.findByTestId('workspace-3d', undefined, { timeout: 10_000 });
  const panel = screen.getByRole('region', { name: 'Parts panel' });
  fireEvent.click(within(within(panel).getByRole('button', { name: 'Hide Plate' }).closest('li')!).getAllByRole('button')[0]!);
  const props = () => vi.mocked(ModelViewport).mock.calls.at(-1)![0];
  await waitFor(() => expect(props().meshes.map(mesh => mesh.name)).toEqual(['Plate', 'Plate 2', 'Shelf']));
  return { workspace, panel, props };
}

it('toggles transparency for the selection or hovered instance and clears it with show all', async () => {
  const { workspace, props } = await visibilityStudio();
  const selected = props().instanceIds![0]!;
  const copy = props().instanceIds![1]!;
  const toggle = (repeat = false) => fireEvent.keyDown(workspace, { key: 'T', code: 'KeyT', shiftKey: true, repeat });
  toggle();
  await waitFor(() => expect(props().transparentIds).toEqual(new Set([selected])));
  toggle(true);
  expect(props().transparentIds).toEqual(new Set([selected]));
  toggle();
  await waitFor(() => expect(props().transparentIds?.size).toBe(0));
  props().onHover?.(props().meshes[1]!.partId, 1);
  toggle();
  await waitFor(() => expect(props().transparentIds).toEqual(new Set([copy])));
  props().onHover?.(null);
  toggle();
  await waitFor(() => expect(props().transparentIds).toEqual(new Set([copy, selected])));
  fireEvent.keyDown(workspace, { key: 'Y', code: 'KeyY', shiftKey: true });
  await waitFor(() => expect(props().transparentIds?.size).toBe(0));
});

it('hides the selected part with Y and shows all parts with Shift+Y', async () => {
  const { workspace, panel, props } = await visibilityStudio();
  // Use the physical key even when the keyboard layout gives it another character.
  fireEvent.keyDown(workspace, { key: 'z', code: 'KeyY' });
  await waitFor(() => expect(within(panel).getByRole('button', { name: 'Show Plate' }).getAttribute('aria-pressed')).toBe('false'));
  expect(props().meshes.map(mesh => mesh.name)).toEqual(['Plate 2', 'Shelf']);
  fireEvent.click(within(panel).getByRole('button', { name: 'Hide Shelf' }));
  fireEvent.keyDown(workspace, { key: 'Z', code: 'KeyY', shiftKey: true });
  await waitFor(() => expect(props().meshes.map(mesh => mesh.name)).toEqual(['Plate', 'Plate 2', 'Shelf']));
  expect(within(panel).getByRole('button', { name: 'Hide Plate' })).toBeDefined();
  expect(within(panel).getByRole('button', { name: 'Hide Shelf' })).toBeDefined();
});

it('hides the hovered part or copy before the selection, and falls back after hover leaves', async () => {
  const { workspace, panel, props } = await visibilityStudio();
  props().onHover?.('shelf');
  fireEvent.keyDown(workspace, { key: 'y', code: 'KeyY' });
  await waitFor(() => expect(within(panel).getByRole('button', { name: 'Show Shelf' })).toBeDefined());
  expect(within(panel).getByRole('button', { name: 'Hide Plate' })).toBeDefined();
  expect(props().meshes.map(mesh => mesh.name)).toEqual(['Plate', 'Plate 2']);
  props().onHover?.(props().meshes[1]!.partId, 1);
  fireEvent.keyDown(workspace, { key: 'y', code: 'KeyY' });
  await waitFor(() => expect(within(panel).getByRole('button', { name: 'Show Plate 2' })).toBeDefined());
  expect(props().meshes.map(mesh => mesh.name)).toEqual(['Plate']);
  props().onHover?.(props().meshes[0]!.partId, 0);
  props().onHover?.(null);
  fireEvent.keyDown(workspace, { key: 'y', code: 'KeyY' });
  await waitFor(() => expect(within(panel).getByRole('button', { name: 'Show Plate' })).toBeDefined());
  expect(props().meshes).toHaveLength(0);
});

it('isolates the selected part including hiding copies, then restores the previous hidden set', async () => {
  const { workspace, panel, props } = await visibilityStudio();
  fireEvent.click(within(panel).getByRole('button', { name: 'Hide Shelf' }));
  fireEvent.click(within(panel).getByRole('button', { name: 'Hide Plate' }));
  fireEvent.keyDown(workspace, { key: 'I', code: 'KeyI', shiftKey: true });
  await waitFor(() => expect(props().meshes.map(mesh => mesh.name)).toEqual(['Plate']));
  expect(within(panel).getByRole('button', { name: 'Hide Plate' })).toBeDefined();
  expect(within(panel).getByRole('button', { name: 'Show Plate 2' })).toBeDefined();
  expect(within(panel).getByRole('button', { name: 'Show Shelf' })).toBeDefined();
  fireEvent.keyDown(workspace, { key: 'I', code: 'KeyI', shiftKey: true, repeat: true });
  expect(props().meshes.map(mesh => mesh.name)).toEqual(['Plate']);
  fireEvent.keyDown(workspace, { key: 'I', code: 'KeyI', shiftKey: true });
  await waitFor(() => expect(props().meshes.map(mesh => mesh.name)).toEqual(['Plate 2']));
  expect(within(panel).getByRole('button', { name: 'Show Plate' })).toBeDefined();
  expect(within(panel).getByRole('button', { name: 'Show Shelf' })).toBeDefined();
});

it('starts a new isolation after the eyes change visibility', async () => {
  const { workspace, panel, props } = await visibilityStudio();
  fireEvent.keyDown(workspace, { key: 'I', code: 'KeyI', shiftKey: true });
  await waitFor(() => expect(props().meshes.map(mesh => mesh.name)).toEqual(['Plate']));
  fireEvent.click(within(panel).getByRole('button', { name: 'Show Shelf' }));
  fireEvent.keyDown(workspace, { key: 'I', code: 'KeyI', shiftKey: true });
  await waitFor(() => expect(props().meshes.map(mesh => mesh.name)).toEqual(['Plate']));
  fireEvent.keyDown(workspace, { key: 'I', code: 'KeyI', shiftKey: true });
  await waitFor(() => expect(props().meshes.map(mesh => mesh.name)).toEqual(['Plate', 'Shelf']));
});

it('ignores visibility shortcuts while typing, using modifiers, or repeating Y', async () => {
  const { workspace, props } = await visibilityStudio();
  for (const field of [document.createElement('input'), document.createElement('textarea'), document.createElement('div')]) {
    if (field instanceof HTMLDivElement) field.contentEditable = 'true';
    workspace.append(field);
    fireEvent.keyDown(field, { key: 'y', code: 'KeyY' });
    fireEvent.keyDown(field, { key: 'Y', code: 'KeyY', shiftKey: true });
    fireEvent.keyDown(field, { key: 'I', code: 'KeyI', shiftKey: true });
    field.remove();
  }
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
    fireEvent.keyDown(workspace, { key: 'y', code: 'KeyY', [modifier]: true });
    fireEvent.keyDown(workspace, { key: 'Y', code: 'KeyY', shiftKey: true, [modifier]: true });
    fireEvent.keyDown(workspace, { key: 'I', code: 'KeyI', shiftKey: true, [modifier]: true });
  }
  fireEvent.keyDown(workspace, { key: 'y', code: 'KeyY', repeat: true });
  expect(props().meshes.map(mesh => mesh.name)).toEqual(['Plate', 'Plate 2', 'Shelf']);
  fireEvent.keyDown(workspace, { key: 'y', code: 'KeyY' });
  await waitFor(() => expect(props().meshes.map(mesh => mesh.name)).toEqual(['Plate 2', 'Shelf']));
  fireEvent.keyDown(workspace, { key: 'Y', code: 'KeyY', shiftKey: true, repeat: true });
  expect(props().meshes.map(mesh => mesh.name)).toEqual(['Plate 2', 'Shelf']);
});

it('opens as a studio, with its own toolbar and steps set in dialogs that keep or drop their changes', async () => {
  const { latest } = await studio();
  const toolbar = await screen.findByRole('toolbar', { name: 'Part Studio toolbar' });
  expect(screen.queryByRole('toolbar', { name: 'Sketch toolbar' })).toBeNull();

  // Extrude always starts a new extrude: of the selected part's sketch, with nothing picked once it's all used.
  await userEvent.click(within(toolbar).getByRole('button', { name: /Extrude/ }));
  let dialog = await screen.findByRole('dialog', { name: 'Extrude · Part 2' });
  await waitFor(() => expect(latest().parts[1]).toMatchObject({ sketchOf: latest().parts[0]!.id, regions: [] }));
  expect(within(dialog).getByRole('button', { name: 'OK' })).toHaveProperty('disabled', true);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(latest().parts).toHaveLength(1));

  // A part's extrude is edited from its step. A changed thickness shows straight away, and the cross puts it back.
  await editExtrude('Plate');
  dialog = await screen.findByRole('dialog', { name: 'Extrude · Plate' });
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
  await editExtrude('Plate');
  dialog = await screen.findByRole('dialog', { name: 'Extrude · Plate' });
  await userEvent.clear(within(dialog).getByRole('textbox', { name: /Thickness/ }));
  await userEvent.type(within(dialog).getByRole('textbox', { name: /Thickness/ }), '0');
  await userEvent.tab();
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'OK' })).toHaveProperty('disabled', true));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(latest().parts[0]!.thickness).toBe(18);

  // The tick keeps it.
  await editExtrude('Plate');
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
  ).toEqual(['Rename', 'Edit…', 'Edit sketch…', 'Suppress', 'Roll to here', 'Delete']);
  // An extrude can be suppressed, as any step but a sketch.
  expect(within(menu).getByRole('menuitem', { name: 'Suppress' }).getAttribute('aria-disabled')).toBeNull();
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
  expect(await screen.findByRole('dialog', { name: /^Extrude · Part / })).toBeDefined();
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

it('moves a part with a transform when Copy part is off, as the reference does by default, and edits the move from its step', async () => {
  const source = createPlateDocument({ width: 200, height: 100 });
  source.parts[0]!.drawnOn = { on: { plane: 'top' }, offset: 0 };
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={change} onFinish={async () => {}} onCancel={() => {}} />
    </div>
  );
  await settled();
  const latest = () => change.mock.calls.at(-1)?.[0] ?? source;
  const toolbar = await screen.findByRole('toolbar', { name: 'Part Studio toolbar' });
  await userEvent.click(within(toolbar).getByRole('button', { name: /Transform/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Transform · Plate' });
  expect(within(dialog).getByRole('checkbox', { name: 'Copy part' })).toHaveProperty('checked', false);
  const z = within(dialog).getAllByRole('textbox')[2]!;
  await userEvent.clear(z);
  await userEvent.type(z, '40');
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(latest().parts[0]!.moved).toEqual({ by: [0, 0, 40] }));
  expect(latest().parts[0]!.copies).toBeUndefined();
  // It's a step of its own, opened again to change.
  const features = screen.getByRole('region', { name: 'Features' });
  await userEvent.dblClick(within(features).getByRole('button', { name: /Transform · Plate/ }));
  const again = await screen.findByRole('dialog', { name: 'Transform · Plate' });
  expect(within(again).queryByRole('checkbox', { name: 'Copy part' })).toBeNull();
  expect(within(again).getAllByRole('textbox')[2]).toHaveProperty('value', '40');
  await userEvent.click(within(again).getByRole('button', { name: 'Cancel' }));
  // Another transform from the toolbar moves it on from there, keeping the first move.
  await userEvent.click(within(toolbar).getByRole('button', { name: /Transform/ }));
  const more = await screen.findByRole('dialog', { name: 'Transform · Plate' });
  const z2 = within(more).getAllByRole('textbox')[2]!;
  await userEvent.clear(z2);
  await userEvent.type(z2, '10');
  await userEvent.click(within(more).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(latest().parts[0]!.moved).toEqual({ by: [0, 0, 50] }));
});

it('copies a part with a transform, and edits the copy from its feature', async () => {
  const { latest } = await studio();
  const toolbar = await screen.findByRole('toolbar', { name: 'Part Studio toolbar' });
  await userEvent.click(within(toolbar).getByRole('button', { name: /Transform/ }));
  let dialog = await screen.findByRole('dialog', { name: 'Transform · Plate' });
  // A transform moves the part unless Copy part is on, as in the reference.
  await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Copy part' }));
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

it('cuts a sketch on a board’s top into it with Extrude → Remove, and makes it a part again with New', async () => {
  const board = { ...createPlateDocument({ width: 200, height: 100, thickness: 18 }).parts[0]!, id: 'board', name: 'Board' };
  board.drawnOn = { on: { plane: 'top' as const }, offset: 0 };
  const pocket = { ...createCadPart('Pocket', 18), drawnOn: { on: { partId: board.id, face: 'top' as const }, offset: 0 } };
  pocket.sketch = addRectangle(pocket.sketch, { x: 50, y: 30, width: 40, height: 20 });
  const source: CadDocument = { ...createCadDocument(), parts: [board, pocket] };
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
  await userEvent.dblClick(within(features).getByRole('button', { name: /Extrude · Pocket/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Extrude · Pocket' });
  const operation = within(dialog).getByRole('tablist', { name: 'Extrude operation' });
  await userEvent.click(within(operation).getByRole('tab', { name: 'Remove' }));
  // The pocket is cut into the board, 6 mm deep to start with. It stays a step with its own sketch, and isn't a part.
  const cuts = () => (latest().parts[0]!.features ?? []).filter(feature => feature.type === 'cut');
  await waitFor(() => expect(cuts().map(cut => cut.type === 'cut' && cut.depth)).toEqual([6]));
  expect(latest().parts[1]!.remove).toEqual({ depth: 6 });
  expect(within(dialog).getByText('Board')).toBeDefined();
  const depth = within(dialog).getByRole('textbox', { name: 'Cut depth' });
  await userEvent.clear(depth);
  await userEvent.type(depth, '8');
  await userEvent.tab();
  await waitFor(() => expect(cuts().map(cut => cut.type === 'cut' && cut.depth)).toEqual([8]));
  await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'End type' }), 'through');
  await waitFor(() => expect(cuts().map(cut => cut.type === 'cut' && cut.depth)).toEqual(['through']));
  // New makes it a part again, as it was.
  await userEvent.click(within(operation).getByRole('tab', { name: 'New' }));
  await waitFor(() => expect(cuts()).toEqual([]));
  expect(latest().parts[1]!.remove).toBeUndefined();
  // Removed again, at the depth last typed, and kept: the board is cut, and the step is listed as an extrude, not as
  // the board's own cut.
  await userEvent.click(within(operation).getByRole('tab', { name: 'Remove' }));
  await waitFor(() => expect(cuts()).toHaveLength(1));
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Extrude · Pocket' })).toBeNull());
  expect(within(features).getByRole('button', { name: /Extrude · Pocket/ }).textContent).toMatch(/remove 8 mm/);
  expect(
    within(features)
      .getAllByRole('button')
      .some(button => /Cut 1/.test(button.textContent ?? ''))
  ).toBe(false);
});

/** A 100 × 50 shelf split at x = 30, extruded from its wider region, beside a side board. */
async function splitShelf() {
  const shelf = { ...createCadPart('Shelf', 18), drawnOn: { on: { plane: 'top' as const }, offset: 0 } };
  shelf.sketch = addRectangle(shelf.sketch, { x: 0, y: 0, width: 100, height: 50 });
  shelf.sketch = addLine(shelf.sketch, { x1: 30, y1: 0, x2: 30, y2: 50 });
  const regions = sketchRegions(shelf.sketch, CAD_CHORD_TOLERANCE);
  const wide = regions.find(region => region.points.some(point => point.x > 99))!.id;
  const narrow = regions.find(region => region.id !== wide)!.id;
  const source: CadDocument = { ...createCadDocument(), parts: [{ ...shelf, regions: [wide] }] };
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
  return { latest, features, wide, narrow };
}

it('extrudes a sketch already used again, as a new part of the regions left, sharing the sketch', async () => {
  const { latest, features, narrow } = await splitShelf();
  await userEvent.click(within(features).getByRole('button', { name: /Sketch · Shelf/ }));
  await userEvent.click(within(screen.getByRole('toolbar', { name: 'Part Studio toolbar' })).getByRole('button', { name: /Extrude/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Extrude · Part 2' });
  expect(within(operation(dialog)).getByRole('tab', { name: 'New' }).getAttribute('aria-selected')).toBe('true');
  await waitFor(() => expect(latest().parts).toHaveLength(2));
  const made = latest().parts[1]!;
  expect(made).toMatchObject({ sketchOf: latest().parts[0]!.id, regions: [narrow] });
  expect(within(dialog).getByText('A region of Shelf’s sketch')).toBeDefined();
  // The regions show in the view, the one picked marked.
  const props = () => vi.mocked(ModelViewport).mock.calls.at(-1)![0];
  await waitFor(() =>
    expect(
      props()
        .regions?.filter(region => region.picked)
        .map(region => region.id)
    ).toEqual([narrow])
  );
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  // The second part is listed by its extrude alone: its sketch is the shelf's.
  await waitFor(() => expect(within(features).getByRole('button', { name: /Extrude · Part 2/ })).toBeDefined());
  expect(within(features).queryByRole('button', { name: /Sketch · Part 2/ })).toBeNull();
  // Editing it from the second part opens the shelf's sketch.
  await userEvent.dblClick(within(features).getByRole('button', { name: /Extrude · Part 2/ }));
  await userEvent.click(
    within(await screen.findByRole('dialog', { name: 'Extrude · Part 2' })).getByRole('button', { name: 'Edit sketch' })
  );
  expect(await screen.findByRole('dialog', { name: 'Sketch · Shelf' })).toBeDefined();
});

const operation = (dialog: HTMLElement) => within(dialog).getByRole('tablist', { name: 'Extrude operation' });

it('adds regions to a part made from the same sketch with Extrude → Add', async () => {
  const { latest, features, wide, narrow } = await splitShelf();
  await userEvent.click(within(features).getByRole('button', { name: /Sketch · Shelf/ }));
  await userEvent.click(within(screen.getByRole('toolbar', { name: 'Part Studio toolbar' })).getByRole('button', { name: /Extrude/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Extrude · Part 2' });
  await userEvent.click(within(operation(dialog)).getByRole('tab', { name: 'Add' }));
  await waitFor(() => expect(latest().parts[1]!.addTo).toBe(latest().parts[0]!.id));
  expect((within(dialog).getByRole('combobox', { name: 'Merge with' }) as HTMLSelectElement).value).toBe(latest().parts[0]!.id);
  await waitFor(() => expect(latest().parts[0]!.addedRegions).toEqual([narrow]));
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Extrude · Part 2' })).toBeNull());
  expect(latest().parts[0]!.regions).toEqual([wide]);
  expect(within(features).getByRole('button', { name: /Extrude · Part 2/ }).textContent).toMatch(/add to Shelf/);
});

it('refuses Add with no part of the same sketch to join, and Remove off a board', async () => {
  const { features } = await splitShelf();
  await userEvent.dblClick(within(features).getByRole('button', { name: /Extrude · Shelf/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Extrude · Shelf' });
  await userEvent.click(within(operation(dialog)).getByRole('tab', { name: 'Add' }));
  expect(within(dialog).getByRole('alert').textContent).toMatch(/Make one with New first/);
  await userEvent.click(within(operation(dialog)).getByRole('tab', { name: 'Remove' }));
  expect(within(dialog).getByRole('alert').textContent).toMatch(/top or underside of a board/);
  expect(within(operation(dialog)).getByRole('tab', { name: 'New' }).getAttribute('aria-selected')).toBe('true');
});

it('picks every region of a sketch that isn’t one outline when it’s extruded from its row', async () => {
  const shelf = { ...createCadPart('Shelf', 18), drawnOn: { on: { plane: 'top' as const }, offset: 0 }, extrude: false as const };
  shelf.sketch = addRectangle(shelf.sketch, { x: 0, y: 0, width: 100, height: 50 });
  shelf.sketch = addLine(shelf.sketch, { x1: 30, y1: 0, x2: 30, y2: 50 });
  const side = { ...createPlateDocument({ width: 130, height: 500, thickness: 20 }).parts[0]!, name: 'Side' };
  const source: CadDocument = { ...createCadDocument(), parts: [side, shelf] };
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
  await userEvent.click(within(features).getByRole('button', { name: /Sketch · Shelf/ }));
  await userEvent.click(within(screen.getByRole('toolbar', { name: 'Part Studio toolbar' })).getByRole('button', { name: /Extrude/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Extrude · Shelf' });
  // Split in two, the sketch isn't one outline. Picked from its row, it starts with both regions.
  const regions = sketchRegions(latest().parts[1]!.sketch, CAD_CHORD_TOLERANCE);
  expect(regions).toHaveLength(2);
  await waitFor(() => expect(latest().parts[1]!.regions).toHaveLength(2));
  expect(within(dialog).queryByRole('alert')).toBeNull();
  expect(within(dialog).getByRole('button', { name: 'OK' })).toHaveProperty('disabled', false);
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

it('patterns a part along a picked Front plane', async () => {
  // Copies are laid out from where their part is, so the part is placed first.
  const source = createPlateDocument({ width: 200, height: 100 });
  source.parts[0]!.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const { latest } = await studio(source);
  const toolbar = await screen.findByRole('toolbar', { name: 'Part Studio toolbar' });
  await userEvent.click(within(toolbar).getByRole('button', { name: /Pattern/ }));
  const dialog = await screen.findByRole('dialog', { name: /^Linear pattern/ });
  await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Pattern copies in a row' }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Direction' }));
  const features = screen.getByRole('region', { name: 'Features' });
  await userEvent.click(within(within(features).getByRole('list', { name: 'Default geometry' })).getByRole('button', { name: /Front/ }));
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Direction' }).textContent).toMatch(/front plane/i));
  await userEvent.clear(within(dialog).getByRole('textbox', { name: 'How many' }));
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'How many' }), '3');
  await userEvent.clear(within(dialog).getByRole('textbox', { name: /Spacing/ }));
  await userEvent.type(within(dialog).getByRole('textbox', { name: /Spacing/ }), '20');
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() =>
    expect(latest().parts[0]!.copies?.map(copy => copy.placement?.position)).toEqual([
      [0, -20, 0],
      [0, -40, 0],
    ])
  );
  expect(latest().parts[0]!.pattern?.direction).toEqual({ along: { plane: 'front' } });
});

it('copies a part by a distance along a plane picked for the direction, as the reference’s Translate by distance', async () => {
  const { latest } = await studio();
  const toolbar = await screen.findByRole('toolbar', { name: 'Part Studio toolbar' });
  await userEvent.click(within(toolbar).getByRole('button', { name: /Transform/ }));
  const dialog = await screen.findByRole('dialog', { name: /^Transform/ });
  await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Copy part' }));
  await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Transform type' }), 'distance');
  // The Direction box waits for a plane or face; one from the feature list fills it.
  await userEvent.click(within(dialog).getByRole('button', { name: 'Direction' }));
  const features = screen.getByRole('region', { name: 'Features' });
  await userEvent.click(within(within(features).getByRole('list', { name: 'Default geometry' })).getByRole('button', { name: /Front/ }));
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Direction' }).textContent).toMatch(/front plane/i));
  const distance = within(dialog).getByRole('textbox', { name: 'Distance' });
  await userEvent.clear(distance);
  await userEvent.type(distance, '30');
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(latest().parts[0]!.copies?.[0]?.along).toMatchObject({ along: { plane: 'front' }, distance: 30 }));
  // The front plane faces -Y, so the copy sits 30 mm that way.
  expect(latest().parts[0]!.copies![0]!.offset!.position).toEqual([0, -30, 0]);
  // Switched to X, Y and Z, it no longer follows the plane.
  fireEvent.contextMenu(within(features).getByRole('button', { name: /Transform · / }));
  await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Edit…' }));
  const again = await screen.findByRole('dialog', { name: /^Transform/ });
  await userEvent.selectOptions(within(again).getByRole('combobox', { name: 'Transform type' }), 'xyz');
  await userEvent.click(within(again).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(latest().parts[0]!.copies![0]!.along).toBeUndefined());
});

it('suppresses an extrude from the feature list, and rolls the design back with the bar', async () => {
  const { latest } = await studio();
  const features = await screen.findByRole('region', { name: 'Features' });
  const parts = screen.getByRole('region', { name: 'Parts panel' });
  // Suppressed, the extrude is struck through and its part is gone from the parts, as in the reference.
  fireEvent.contextMenu(within(features).getByRole('button', { name: /Extrude · Plate/ }));
  await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Suppress' }));
  await waitFor(() => expect(latest().parts[0]!.suppressed).toBe(true));
  expect(
    within(features)
      .getByRole('button', { name: /Extrude · Plate/ })
      .closest('li')!.className
  ).toMatch(/cad-feature-suppressed/);
  expect(within(parts).queryByText('Plate')).toBeNull();
  fireEvent.contextMenu(within(features).getByRole('button', { name: /Extrude · Plate/ }));
  await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Unsuppress' }));
  await waitFor(() => expect(latest().parts[0]!.suppressed).toBeUndefined());
  expect(within(parts).getByText('Plate')).toBeDefined();
  // Roll to here puts the bar after the sketch: the extrude after it is greyed out.
  fireEvent.contextMenu(within(features).getByRole('button', { name: /Sketch · Plate/ }));
  await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Roll to here' }));
  await waitFor(() =>
    expect(
      within(features)
        .getByRole('button', { name: /Extrude · Plate/ })
        .closest('li')!.className
    ).toMatch(/cad-feature-rolled-back/)
  );
  // A greyed step's menu offers Roll to end, found by the step itself even after the list re-renders.
  fireEvent.contextMenu(within(features).getByRole('button', { name: /Extrude · Plate/ }));
  expect(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Roll to end' })).toBeDefined();
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  // The bar steps down with the arrow keys, back to the end.
  const bar = within(features).getByRole('separator', { name: 'Shown up to here' });
  bar.focus();
  await userEvent.keyboard('{ArrowDown}');
  await waitFor(() =>
    expect(
      within(features)
        .getByRole('button', { name: /Extrude · Plate/ })
        .closest('li')!.className
    ).not.toMatch(/cad-feature-rolled-back/)
  );
});

it('saves a picked-direction distance expression and removes it when replaced by a number', async () => {
  const source = createPlateDocument({ width: 200, height: 100 });
  source.variables = [{ id: 'gap-variable', name: 'gap', expression: '30mm' }];
  const { latest } = await studio(source);
  const toolbar = await screen.findByRole('toolbar', { name: 'Part Studio toolbar' });
  await userEvent.click(within(toolbar).getByRole('button', { name: /Transform/ }));
  let dialog = await screen.findByRole('dialog', { name: /^Transform/ });
  await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Copy part' }));
  await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Transform type' }), 'distance');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Direction' }));
  const features = screen.getByRole('region', { name: 'Features' });
  await userEvent.click(within(within(features).getByRole('list', { name: 'Default geometry' })).getByRole('button', { name: /Front/ }));
  const distance = within(dialog).getByRole('textbox', { name: 'Distance' });
  await userEvent.clear(distance);
  await userEvent.type(distance, '#gap');
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(latest().parts[0]!.copies?.[0]?.along).toMatchObject({ distance: 30, distanceExpression: '#gap' }));
  await userEvent.dblClick(within(features).getByRole('button', { name: /Transform · Plate 2/ }));
  dialog = await screen.findByRole('dialog', { name: /^Transform/ });
  expect(within(dialog).getByRole('textbox', { name: 'Distance' })).toHaveValue('#gap');
  await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Distance' }));
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Distance' }), '40');
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(latest().parts[0]!.copies?.[0]?.along?.distance).toBe(40));
  expect(latest().parts[0]!.copies![0]!.along).not.toHaveProperty('distanceExpression');
});

it('reorders parts by dragging a step onto another in the feature list', async () => {
  const [a, b] = [
    { ...createPlateDocument({ width: 100, height: 50 }).parts[0]!, name: 'A' },
    { ...createPlateDocument({ width: 80, height: 40 }).parts[0]!, name: 'B' },
  ];
  const source: CadDocument = { ...createCadDocument(), parts: [a, b] };
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
  const dragged = within(features).getByRole('button', { name: /Extrude · B/ });
  const onto = within(features)
    .getByRole('button', { name: /Sketch · A/ })
    .closest('li')!;
  const dataTransfer = new DataTransfer();
  const drag = (target: Element, type: string) =>
    target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
  drag(dragged, 'dragstart');
  drag(onto, 'dragover');
  drag(onto, 'drop');
  await waitFor(() => expect(latest().parts.map(part => part.name)).toEqual(['B', 'A']));
});

it('extrudes up to a picked plane, its thickness following the distance, or symmetrically about its own plane', async () => {
  const post = { ...createPlateDocument({ width: 100, height: 50 }).parts[0]!, name: 'Post' };
  // Drawn 300 mm in front of the Front plane, facing away from it.
  post.drawnOn = { on: { plane: 'front' }, offset: -300 };
  const source: CadDocument = { ...createCadDocument(), parts: [post] };
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
  await userEvent.dblClick(within(features).getByRole('button', { name: /Extrude · Post/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Extrude · Post' });
  await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Symmetric' }));
  await waitFor(() => expect(latest().parts[0]!.symmetric).toBe(true));
  await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'End type' }), 'upTo');
  await userEvent.click(within(within(features).getByRole('list', { name: 'Default geometry' })).getByRole('button', { name: /Front/ }));
  await waitFor(() => expect(latest().parts[0]!.upTo).toEqual({ plane: 'front' }));
  expect(latest().parts[0]!.symmetric).toBeUndefined();
  await waitFor(() => expect(latest().parts[0]!.thickness).toBe(300));
  // Thin has a depth of its own, so it leaves Up to face, and its thickness can be typed again.
  await userEvent.click(within(dialog).getByRole('tab', { name: 'Thin' }));
  await waitFor(() => expect(latest().parts[0]!.upTo).toBeUndefined());
  await userEvent.click(within(dialog).getByRole('tab', { name: 'Solid' }));
  // Choosing Blind while a face is still to be picked stops waiting for it: a plane clicked next is only selected.
  await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'End type' }), 'upTo');
  await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'End type' }), 'blind');
  expect((within(dialog).getByRole('combobox', { name: 'End type' }) as HTMLSelectElement).value).toBe('blind');
  await userEvent.click(within(within(features).getByRole('list', { name: 'Default geometry' })).getByRole('button', { name: /Right/ }));
  expect(latest().parts[0]!.upTo).toBeUndefined();
});

it('makes a variable from `#name = value` in a field and uses it there, and lists variables after `#`', async () => {
  const { latest } = await studio();
  await editExtrude('Plate');
  let dialog = await screen.findByRole('dialog', { name: 'Extrude · Plate' });
  let thickness = within(dialog).getByRole('textbox', { name: /Thickness/ });
  await userEvent.clear(thickness);
  await userEvent.type(thickness, '#board = 19 mm{Enter}');
  await waitFor(() => expect(latest().variables?.map(variable => [variable.name, variable.expression])).toEqual([['board', '19 mm']]));
  await waitFor(() => expect(latest().parts[0]!.thickness).toBe(19));
  expect(latest().parts[0]!.thicknessExpression).toMatch(/board/);

  // Typing # offers the design's variables, and picking one puts it in the field.
  dialog = await screen.findByRole('dialog', { name: 'Extrude · Plate' }).catch(async () => {
    await editExtrude('Plate');
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
  await editExtrude('Plate');
  const dialog = await screen.findByRole('dialog', { name: 'Extrude · Plate' });
  const thickness = within(dialog).getByRole('textbox', { name: /Thickness/ });
  await userEvent.clear(thickness);
  await userEvent.type(thickness, '#board = 19 mm');
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Extrude · Plate' })).toBeNull());
  expect(latest().variables?.map(variable => variable.name)).toEqual(['board']);
  // The design takes the thickness once the variable is in it, which can be a solve after the dialog closed.
  await waitFor(() => expect(latest().parts[0]!.thickness).toBe(19));
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
  // Enter applies the field and keeps the dialog open, as in the reference; Enter again keeps the step, as the tick does.
  expect(screen.getByRole('dialog', { name: 'Extrude · Back' })).toBeDefined();
  await userEvent.keyboard('{Enter}');
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
  await editExtrude('Plate');
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
  // Each end is tied to the side board's corner it was used from, so it follows that board.
  expect(ends.every(end => end.type === 'point' && end.used?.partId === side.id)).toBe(true);
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
  // The drawing turns inside the canvas, so its lines keep their width.
  expect(screen.getByTestId('cad-drawing').getAttribute('transform')).toMatch(/matrix\(/);
  expect(canvas.style.transform).toBe('');
  expect(screen.queryByRole('menu')).toBeNull();
  // n looks straight at the plane again, and once more, at its other side.
  canvas.focus();
  await userEvent.keyboard('n');
  await waitFor(() => expect(canvas.hasAttribute('data-sketch-turned')).toBe(false));
  await userEvent.keyboard('n');
  await waitFor(() => expect(screen.getByTestId('cad-drawing').getAttribute('transform')).toMatch(/matrix\(-1 0 0 1 0 0\)/));
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
