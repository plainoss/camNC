import { createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { settled } from '@/test/settled';
import { ModelViewport } from '@/cam/model/ModelViewport';
import { closeStudioMenu, studioCommand } from './studioToolbarTesting';

vi.mock('@/cam/model/ModelViewport', { spy: true });

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});

async function studio() {
  const source = createPlateDocument({ width: 200, height: 100 });
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={change} onFinish={async () => {}} onCancel={() => {}} />
    </div>
  );
  // The 3D view is loaded lazily, which the settled signal can't see before its module arrives: wait for its canvas.
  await waitFor(() => expect(screen.getByTestId('workspace-3d').querySelector('canvas')).not.toBeNull(), { timeout: 20_000 });
  await settled();
  return {
    latest: () => change.mock.calls.at(-1)?.[0] ?? source,
    done: () => within(screen.getByRole('toolbar', { name: 'Part Studio toolbar' })).getByRole('button', { name: /Done/ }),
  };
}

async function start(command: RegExp, dialog: string | RegExp) {
  await userEvent.click(await studioCommand(command));
  return screen.findByRole('dialog', { name: dialog });
}

it('replaces an open Fillet dialog with the Transform started next, and the other way round', async () => {
  await studio();
  await start(/^Fillet/, 'Fillet');
  await start(/^Transform/, /^Transform/);
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  await start(/^Fillet/, 'Fillet');
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
});

it.each([
  [/^Mirror/, 'Mirror'],
  [/^Fillet/, 'Fillet'],
] as const)('holds Done back while the %s dialog is open', async (command, name) => {
  const { done } = await studio();
  expect(done()).toHaveProperty('disabled', false);
  const dialog = await start(command, name);
  await closeStudioMenu();
  expect(done()).toHaveProperty('disabled', true);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await settled();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(done()).toHaveProperty('disabled', false);
});

it('keeps what an Extrude dialog set when its sketch is opened from it', async () => {
  const { latest } = await studio();
  await userEvent.dblClick(within(screen.getByRole('region', { name: 'Features' })).getByRole('button', { name: /Extrude · Plate/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Extrude · Plate' });
  const thickness = within(dialog).getByRole('textbox', { name: /Thickness/ });
  await userEvent.clear(thickness);
  await userEvent.type(thickness, '30');
  await userEvent.tab();
  await settled();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Edit sketch' }));
  await screen.findByRole('toolbar', { name: 'Sketch toolbar' });
  await settled();
  expect(screen.queryByRole('dialog', { name: 'Extrude · Plate' })).toBeNull();
  expect(latest().parts[0]!.thickness).toBe(30);
});

it('leaves the open dialog alone when the command chosen next is refused', async () => {
  await studio();
  await start(/^Variable/, 'Variable');
  await userEvent.click(await studioCommand(/^Hole/));
  expect((await screen.findByRole('alert')).textContent).toMatch(/^Hole drills at the points of a sketch on Plate/);
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(screen.getByRole('dialog', { name: 'Variable' })).toBeDefined();
});

it('shows a depth being dragged in the Extrude dialog before the design has it', async () => {
  const { latest } = await studio();
  await userEvent.dblClick(within(screen.getByRole('region', { name: 'Features' })).getByRole('button', { name: /Extrude · Plate/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Extrude · Plate' });
  const depth = () => vi.mocked(ModelViewport).mock.calls.findLast(([props]) => props.extrusionDepth)![0].extrusionDepth!;
  const before = latest().parts[0]!.thickness;
  act(() => depth().onStart());
  act(() => depth().onPreview(42));
  await waitFor(() => expect(within(dialog).getByRole('textbox', { name: /Thickness/ })).toHaveProperty('value', '42'));
  expect(latest().parts[0]!.thickness).toBe(before);
  act(() => depth().onFinish(42));
  await waitFor(() => expect(latest().parts[0]!.thickness).toBe(42));
  expect(within(dialog).getByRole('textbox', { name: /Thickness/ })).toHaveProperty('value', '42');
});
