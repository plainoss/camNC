import { createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { ModelViewport } from '@/cam/model/ModelViewport';

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
  await waitFor(() => expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false'), { timeout: 20_000 });
  return {
    latest: () => change.mock.calls.at(-1)?.[0] ?? source,
    toolbar: screen.getByRole('toolbar', { name: 'Part Studio toolbar' }),
  };
}

async function editExtrude() {
  await userEvent.dblClick(within(screen.getByRole('region', { name: 'Features' })).getByRole('button', { name: /Extrude · Plate/ }));
  return screen.findByRole('dialog', { name: 'Extrude · Plate' });
}

// Keep independent dialog workflows in separate tests: together their solver and pointer work exceeded
// the browser test deadline on a loaded runner, without any individual behavior assertion failing (#363).
it('opens with the studio toolbar and cancels a new extrude without changing the design', async () => {
  const { latest, toolbar } = await studio();
  expect(screen.queryByRole('toolbar', { name: 'Sketch toolbar' })).toBeNull();
  await userEvent.click(within(toolbar).getByRole('button', { name: /Extrude/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Extrude · Part 2' });
  await waitFor(() => expect(latest().parts[1]).toMatchObject({ sketchOf: latest().parts[0]!.id, regions: [] }));
  expect(within(dialog).getByRole('button', { name: 'OK' })).toHaveProperty('disabled', true);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(latest().parts).toHaveLength(1));
});

it('previews an extrude thickness and restores it when the dialog is cancelled', async () => {
  const { latest, toolbar } = await studio();
  const dialog = await editExtrude();
  const thickness = within(dialog).getByRole('textbox', { name: /Thickness/ });
  await userEvent.clear(thickness);
  await userEvent.type(thickness, '30');
  await userEvent.tab();
  await waitFor(() => expect(latest().parts[0]!.thickness).toBe(30));
  expect(within(toolbar).getByRole('button', { name: /Done/ })).toHaveProperty('disabled', true);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(latest().parts[0]!.thickness).toBe(18));
  expect(screen.queryByRole('dialog', { name: 'Extrude · Plate' })).toBeNull();
});

it('refuses an unusable extrude thickness and leaves the original thickness on cancel', async () => {
  const { latest } = await studio();
  const dialog = await editExtrude();
  const thickness = within(dialog).getByRole('textbox', { name: /Thickness/ });
  await userEvent.clear(thickness);
  await userEvent.type(thickness, '0');
  await userEvent.tab();
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'OK' })).toHaveProperty('disabled', true));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(latest().parts[0]!.thickness).toBe(18);
});

it('keeps an extrude thickness when OK is clicked straight after typing', async () => {
  const { latest } = await studio();
  const dialog = await editExtrude();
  const thickness = within(dialog).getByRole('textbox', { name: /Thickness/ });
  await userEvent.clear(thickness);
  await userEvent.type(thickness, '24');
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(latest().parts[0]!.thickness).toBe(24));
  expect(screen.queryByRole('dialog', { name: 'Extrude · Plate' })).toBeNull();
});

it('previews a pattern on opening, cancels its changes, and keeps an accepted pattern', async () => {
  const { latest, toolbar } = await studio();
  await userEvent.click(within(toolbar).getByRole('button', { name: /Pattern/ }));
  let dialog = await screen.findByRole('dialog', { name: 'Linear pattern · Plate' });
  expect(within(dialog).queryByRole('checkbox', { name: 'Pattern copies in a row' })).toBeNull();
  await waitFor(() => expect(vi.mocked(ModelViewport).mock.lastCall![0].instanceIds).toHaveLength(2));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(latest().parts[0]!.pattern).toBeUndefined());
  await userEvent.click(within(toolbar).getByRole('button', { name: /Pattern/ }));
  dialog = await screen.findByRole('dialog', { name: 'Linear pattern · Plate' });
  await waitFor(() => expect(vi.mocked(ModelViewport).mock.lastCall![0].instanceIds).toHaveLength(2));
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  expect(latest().parts[0]!.pattern).toBeDefined();
});
