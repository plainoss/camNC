import { createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { invalidate } from '@react-three/fiber';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { page, userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { ModelViewport } from '@/cam/model/ModelViewport';
import type { StudioCameraState } from './studioCamera';

vi.mock('@/cam/model/ModelViewport', { spy: true });
let sessionId = '';
afterEach(async () => {
  cleanup();
  if (sessionId) endCadSession(sessionId);
  sessionId = '';
  await page.viewport(1280, 800);
});

async function setup() {
  await page.viewport(1776, 1115);
  const source = createPlateDocument({ width: 100, height: 60, thickness: 18 });
  sessionId = source.id;
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 900, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  await waitFor(() => expect(document.querySelector('.cad-editor')).toHaveAttribute('aria-busy', 'false'), { timeout: 20_000 });
  // The lazy workspace can still be loading after the document's busy flag clears.
  const frame = await screen.findByTestId('workspace-3d', {}, { timeout: 20_000 });
  const props = () => vi.mocked(ModelViewport).mock.calls.findLast(([props]) => props.cameraState)![0];
  // Real shader/context startup may take longer than a second when several browser pages share the GPU.
  await waitFor(() => expect(props().cameraState!.current).not.toBeNull(), { timeout: 20_000 });
  const view = async (digit: number, z: number) => {
    frame.focus();
    await userEvent.keyboard(`{Shift>}${digit}{/Shift}`);
    await waitFor(() => expect(props().cameraState!.current!.back[2]).toBeCloseTo(z, 6), { timeout: 20_000 });
  };
  const click = async (point: [number, number, number]) => {
    const canvas = frame.querySelector('canvas')!;
    const camera = props().cameraState!.current!;
    const box = canvas.getBoundingClientRect();
    const { back, up, center, height } = camera;
    const right = [up[1] * back[2] - up[2] * back[1], up[2] * back[0] - up[0] * back[2], up[0] * back[1] - up[1] * back[0]];
    const delta = point.map((value, axis) => value - center[axis]!);
    const dot = (axis: number[]) => axis.reduce((sum, value, index) => sum + value * delta[index]!, 0);
    await userEvent.click(canvas, {
      position: { x: box.width / 2 + (dot(right) * box.height) / height, y: box.height / 2 - (dot(up) * box.height) / height },
    });
  };
  const zBounds = () => {
    const mesh = props().meshes[0]!;
    const zs = Array.from(mesh.indices, index => mesh.positions[index * 3 + 2]!);
    return [Math.min(...zs), Math.max(...zs)];
  };
  const unchanged = () => {
    expect(change.mock.calls.at(-1)?.[0] ?? source).toEqual(source);
    expect(screen.getByRole('button', { name: 'Undo (Ctrl or Command Z)' })).toBeDisabled();
    expect(props().instanceIds).toEqual([source.parts[0]!.id]);
    expect(props().meshes[0]!.partId).toBe(source.parts[0]!.id);
  };
  return { source, frame, props, view, click, zBounds, unchanged };
}

async function openTopSection(offset = '9') {
  await userEvent.click(screen.getByRole('button', { name: 'Section view' }));
  const dialog = await screen.findByRole('dialog', { name: 'Section view' });
  await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Section plane' }), 'top');
  await userEvent.fill(page.getByRole('textbox', { name: 'Offset', exact: true }), offset);
  return dialog;
}

async function topSection(offset = '9') {
  const dialog = await openTopSection(offset);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm section view' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Section view' })).toBeNull());
}

async function sameCamera(before: StudioCameraState, current: () => StudioCameraState) {
  const previous = current();
  // The viewport renders on demand and publishes its camera in useFrame; request one final observation frame.
  invalidate();
  await waitFor(() => expect(current()).not.toBe(previous), { timeout: 20_000 });
  const after = current();
  for (const key of ['center', 'back', 'up'] as const)
    after[key].forEach((value, axis) => expect(value).toBeCloseTo(before[key][axis]!, 6));
  expect(after.height).toBeCloseTo(before.height, 6);
}

/** Independently project one millimetre along the world normal into CSS pixels. */
function screenAxis(camera: StudioCameraState, normal: number[], height: number) {
  const { up, back } = camera;
  const right = [up[1] * back[2] - up[2] * back[1], up[2] * back[0] - up[0] * back[2], up[0] * back[1] - up[1] * back[0]];
  const dot = (axis: number[]) => axis.reduce((sum, value, index) => sum + value * normal[index]!, 0);
  return { x: (dot(right) * height) / camera.height, y: (-dot(up) * height) / camera.height };
}

async function offsetGrip(frame: HTMLElement, props: () => Parameters<typeof ModelViewport>[0]) {
  const handle = await screen.findByRole('slider', { name: 'Section offset' });
  const canvas = frame.querySelector('canvas')!;
  const layout = () => {
    const camera = structuredClone(props().cameraState!.current!);
    const control = props().sectionControl!;
    const box = canvas.getBoundingClientRect(),
      grip = handle.getBoundingClientRect();
    const axis = screenAxis(camera, control.normal, box.height);
    const { up, back } = camera;
    const right = [up[1] * back[2] - up[2] * back[1], up[2] * back[0] - up[0] * back[2], up[0] * back[1] - up[1] * back[0]];
    const delta = control.origin.map((value, index) => value - camera.center[index]!);
    const dot = (basis: number[]) => basis.reduce((sum, value, index) => sum + value * delta[index]!, 0);
    const scale = Math.hypot(axis.x, axis.y) > 0.01 ? 30 / Math.hypot(axis.x, axis.y) : 10;
    const expected = {
      x: box.left + box.width / 2 + (dot(right) * box.height) / camera.height + axis.x * scale,
      y: box.top + box.height / 2 - (dot(up) * box.height) / camera.height + axis.y * scale,
    };
    return { handle, canvas, camera, control, box, grip, axis, expected };
  };
  // Html is positioned on a render frame after its parent's control props change, especially when Flip reverses it.
  await waitFor(
    () => {
      const { grip, control, expected } = layout();
      expect(Number(handle.getAttribute('aria-valuenow'))).toBe(control.offset);
      expect(Math.abs(grip.left + grip.width / 2 - expected.x)).toBeLessThan(1);
      expect(Math.abs(grip.top + grip.height / 2 - expected.y)).toBeLessThan(1);
    },
    { timeout: 20_000 }
  );
  return layout();
}

it('measures real section faces, flips the retained material and restores the original solid without editing it', async () => {
  const { props, view, click, zBounds, unchanged } = await setup();
  const original = props().meshes[0]!;
  await topSection();
  expect(screen.getByRole('button', { name: 'Edit section view' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Turn off section view' })).toBeVisible();
  await waitFor(() => expect(zBounds()).toEqual([0, 9]));
  await view(5, 1);
  await click([50, 30, 9]);
  const quick = await screen.findByRole('region', { name: 'Selection measurements' });
  expect(within(quick).getByRole('button', { name: 'Area: 6000 mm²' })).toBeVisible();
  await userEvent.click(within(quick).getByRole('button', { name: 'Measure [' }));
  const measure = await screen.findByRole('dialog', { name: 'Measure' });
  await view(6, -1);
  await click([50, 30, 0]);
  await waitFor(() => expect(within(measure).getByRole('button', { name: 'Min distance: 9 mm' })).toBeVisible());
  const picked = within(measure).getByRole('list', { name: 'Measured entities' });
  expect(picked.children).toHaveLength(2);
  expect(picked).toHaveTextContent('Plate · face');
  await userEvent.click(within(measure).getByRole('button', { name: 'Close Measure' }));
  unchanged();

  await userEvent.click(screen.getByRole('button', { name: 'Edit section view' }));
  const edit = await screen.findByRole('dialog', { name: 'Section view' });
  expect(within(edit).getByRole('combobox', { name: 'Section plane' })).toHaveValue('top');
  expect(within(edit).getByRole('textbox', { name: 'Offset' })).toHaveValue('9');
  await userEvent.click(within(edit).getByRole('button', { name: 'Flip plane' }));
  await userEvent.click(within(edit).getByRole('button', { name: 'Confirm section view' }));
  await waitFor(() => expect(zBounds()).toEqual([9, 18]));
  expect(screen.queryByRole('region', { name: 'Selection measurements' })).toBeNull();
  await view(6, -1);
  await click([50, 30, 9]);
  const flippedQuick = await screen.findByRole('region', { name: 'Selection measurements' });
  expect(within(flippedQuick).getByRole('button', { name: 'Area: 6000 mm²' })).toBeVisible();
  unchanged();

  await userEvent.click(screen.getByRole('button', { name: 'Turn off section view' }));
  await waitFor(() => expect(props().meshes[0]).toBe(original));
  expect(zBounds()).toEqual([0, 18]);
  expect(screen.queryByRole('button', { name: 'Edit section view' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Selection measurements' })).toBeNull();
  await view(5, 1);
  await click([50, 30, 18]);
  await userEvent.click(await screen.findByRole('button', { name: 'Measure [' }));
  const restoredMeasure = await screen.findByRole('dialog', { name: 'Measure' });
  await view(6, -1);
  await click([50, 30, 0]);
  await waitFor(() => expect(within(restoredMeasure).getByRole('button', { name: 'Min distance: 18 mm' })).toBeVisible());
  unchanged();
}, 40_000);

it('keeps section controls in view state through keyboard entry, normal view, invalid input, reopening and Escape', async () => {
  const { frame, props, unchanged } = await setup();
  frame.focus();
  await userEvent.keyboard('{Shift>}x{/Shift}');
  const dialog = await screen.findByRole('dialog', { name: 'Section view' });
  const plane = within(dialog).getByRole('combobox', { name: 'Section plane' });
  expect(plane).toHaveValue('');
  expect(within(dialog).getByRole('button', { name: 'Confirm section view' })).toBeDisabled();
  await userEvent.selectOptions(plane, 'top');
  await userEvent.fill(page.getByRole('textbox', { name: 'Offset', exact: true }), '9');
  await userEvent.click(within(dialog).getByRole('button', { name: 'View normal' }));
  await waitFor(() => expect(props().cameraState!.current!.back[2]).toBeCloseTo(1, 6), { timeout: 20_000 });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm section view' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Edit section view' }));
  const reopened = await screen.findByRole('dialog', { name: 'Section view' });
  const offset = within(reopened).getByRole('textbox', { name: 'Offset' });
  expect(offset).toHaveValue('9');
  await userEvent.fill(page.getByRole('textbox', { name: 'Offset', exact: true }), 'not a length');
  expect(offset).toHaveAttribute('aria-invalid', 'true');
  expect(within(reopened).getByRole('button', { name: 'Confirm section view' })).toBeDisabled();
  await userEvent.keyboard('{Enter}{Enter}');
  expect(reopened).toBeVisible();
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Section view' })).toBeNull());
  expect(screen.queryByRole('button', { name: 'Edit section view' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Section view' })).toBeVisible();
  unchanged();

  frame.focus();
  await userEvent.keyboard('{Shift>}x{/Shift}');
  await screen.findByRole('dialog', { name: 'Section view' });
  frame.focus();
  await userEvent.keyboard('{Shift>}x{/Shift}');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Section view' })).toBeNull());
  unchanged();
}, 40_000);

it('uses the actual picked model face as a section plane with a signed offset', async () => {
  const { view, click, zBounds, unchanged } = await setup();
  await view(5, 1);
  await userEvent.click(screen.getByRole('button', { name: 'Section view' }));
  const dialog = await screen.findByRole('dialog', { name: 'Section view' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Pick planar face' }));
  await click([50, 30, 18]);
  const plane = within(dialog).getByRole('combobox', { name: 'Section plane' });
  await waitFor(() => expect(plane).toHaveValue('picked-face'));
  expect(within(plane).getByRole('option', { name: 'Plate face' })).toBeDefined();
  await userEvent.fill(page.getByRole('textbox', { name: 'Offset', exact: true }), '-9');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm section view' }));
  await waitFor(() => expect(zBounds()).toEqual([0, 9]));
  await click([50, 30, 9]);
  const quick = await screen.findByRole('region', { name: 'Selection measurements' });
  expect(within(quick).getByRole('button', { name: 'Area: 6000 mm²' })).toBeVisible();
  expect(screen.queryByRole('dialog', { name: /^Sketch/ })).toBeNull();
  unchanged();
}, 40_000);

it('starts a new geometry selection after moving the section inside the old double-click window', async () => {
  const { view, click, zBounds, unchanged } = await setup();
  await topSection();
  await view(5, 1);
  // Keep the two geometry picks inside the double-click window independently of browser/GPU speed.
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
  try {
    await click([50, 30, 9]);
    await screen.findByRole('region', { name: 'Selection measurements' });
    await userEvent.click(screen.getByRole('button', { name: 'Edit section view' }));
    const edit = await screen.findByRole('dialog', { name: 'Section view' });
    await userEvent.fill(page.getByRole('textbox', { name: 'Offset', exact: true }), '12');
    await userEvent.click(within(edit).getByRole('button', { name: 'Confirm section view' }));
    await waitFor(() => expect(zBounds()).toEqual([0, 12]));
    await act(async () => click([50, 30, 12]));
    expect(screen.getByTestId('workspace-3d')).toBeVisible();
    expect(screen.queryByRole('dialog', { name: /^Sketch/ })).toBeNull();
    const quick = await screen.findByRole('region', { name: 'Selection measurements' });
    expect(within(quick).getByRole('button', { name: 'Area: 6000 mm²' })).toBeVisible();
    unchanged();
  } finally {
    now.mockRestore();
  }
}, 40_000);

it('keeps grip clicks precise and edits its signed offset with native one and ten millimetre arrow steps', async () => {
  const { frame, props, unchanged } = await setup();
  const dialog = await openTopSection('9.123456789mm');
  const offset = within(dialog).getByRole('textbox', { name: 'Offset' });
  const { handle, canvas, grip, box, camera } = await offsetGrip(frame, props);
  await userEvent.click(handle);
  expect(offset).toHaveValue('9.123456789mm');
  await userEvent.dragAndDrop(handle, canvas, {
    targetPosition: { x: grip.left + grip.width / 2 - box.left + 1, y: grip.top + grip.height / 2 - box.top },
  });
  expect(offset).toHaveValue('9.123456789mm');
  expect(handle).toHaveAttribute('aria-valuenow', '9.123456789');
  for (const modifiers of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { isComposing: true }, { keyCode: 229 }]) {
    expect(fireEvent.keyDown(handle, { key: 'ArrowLeft', ...modifiers })).toBe(true);
    expect(offset).toHaveValue('9.123456789mm');
  }
  await userEvent.keyboard('{ArrowUp}');
  await waitFor(() => expect(Number((offset as HTMLInputElement).value)).toBeCloseTo(10.123456789, 9));
  await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
  expect(Number((offset as HTMLInputElement).value)).toBeCloseTo(20.123456789, 9);
  await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}{ArrowDown}');
  expect(Number((offset as HTMLInputElement).value)).toBeCloseTo(9.123456789, 9);
  await sameCamera(camera, () => props().cameraState!.current!);
  unchanged();
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Section view' })).toBeNull());
}, 40_000);

it.each([false, true])(
  'moves the section with a real captured pointer without moving the camera or selecting a part (flipped=%s)',
  async flipped => {
    const { frame, props, zBounds, unchanged } = await setup();
    const dialog = await openTopSection('9.123456789mm');
    if (flipped) await userEvent.click(within(dialog).getByRole('button', { name: 'Flip plane' }));
    const { handle, canvas, box, grip, camera, control, axis } = await offsetGrip(frame, props);
    const distance = (12.375 - control.offset) / control.factor;
    const events: { start: PointerEvent | null; end: PointerEvent | null } = { start: null, end: null };
    const captured: boolean[] = [],
      dragging: boolean[] = [];
    handle.addEventListener('pointerdown', event => {
      events.start = event;
    });
    handle.addEventListener('pointermove', event => {
      if (!(event.buttons & 1)) return;
      captured.push(handle.hasPointerCapture(event.pointerId));
      dragging.push(!!props().sectionControl?.dragging);
    });
    handle.addEventListener('pointerup', event => {
      events.end = event;
    });
    await userEvent.dragAndDrop(handle, canvas, {
      targetPosition: {
        x: grip.left + grip.width / 2 - box.left + axis.x * distance,
        y: grip.top + grip.height / 2 - box.top + axis.y * distance,
      },
    });
    expect(events.start).not.toBeNull();
    expect(events.end).not.toBeNull();
    expect(captured).toContain(true);
    expect(dragging).toContain(true);
    expect(handle.hasPointerCapture(events.start!.pointerId)).toBe(false);
    const delta =
      ((events.end!.clientX - events.start!.clientX) * axis.x + (events.end!.clientY - events.start!.clientY) * axis.y) /
      (axis.x ** 2 + axis.y ** 2);
    const expected = control.offset + delta * control.factor;
    expect(expected).toBeGreaterThan(9);
    expect(expected).toBeLessThan(18);
    const offset = within(dialog).getByRole('textbox', { name: 'Offset' }) as HTMLInputElement;
    await waitFor(() => expect(Number(offset.value)).toBeCloseTo(expected, 7));
    expect(props().sectionControl!.dragging).toBe(false);
    expect(dialog).toBeVisible();
    expect(screen.queryByRole('dialog', { name: /^Sketch/ })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Selection measurements' })).toBeNull();
    await sameCamera(camera, () => props().cameraState!.current!);
    unchanged();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm section view' }));
    await waitFor(() => expect(zBounds()[flipped ? 0 : 1]).toBeCloseTo(expected, 5));
    unchanged();
  },
  40_000
);

it('cancels a real captured drag with Escape, restores the original expression, and turns off only on the next Escape', async () => {
  const { frame, props, unchanged } = await setup();
  const text = '9.123456789mm';
  const dialog = await openTopSection(text);
  const { handle, canvas, box, grip, camera, axis } = await offsetGrip(frame, props);
  const events: { start: PointerEvent | null } = { start: null };
  let cancelled = false,
    captured = false;
  handle.addEventListener('pointerdown', event => {
    events.start = event;
  });
  handle.addEventListener('pointermove', event => {
    if (
      !(event.buttons & 1) ||
      cancelled ||
      !events.start ||
      Math.hypot(event.clientX - events.start.clientX, event.clientY - events.start.clientY) < 2
    )
      return;
    cancelled = true;
    captured = handle.hasPointerCapture(event.pointerId);
    // Dispatch after the actual pointer-move preview; the browser still owns a pressed, captured pointer here.
    queueMicrotask(() => fireEvent.keyDown(handle, { key: 'Escape', code: 'Escape' }));
  });
  await userEvent.dragAndDrop(handle, canvas, {
    targetPosition: { x: grip.left + grip.width / 2 - box.left + axis.x * 3, y: grip.top + grip.height / 2 - box.top + axis.y * 3 },
  });
  expect(cancelled).toBe(true);
  expect(captured).toBe(true);
  expect(dialog).toBeVisible();
  expect(within(dialog).getByRole('textbox', { name: 'Offset' })).toHaveValue(text);
  expect(props().sectionControl!.dragging).toBe(false);
  await sameCamera(camera, () => props().cameraState!.current!);
  unchanged();
  handle.focus();
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Section view' })).toBeNull());
  expect(screen.queryByRole('button', { name: 'Edit section view' })).toBeNull();
  unchanged();
}, 40_000);
