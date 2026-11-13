import { createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { ModelViewport } from '@/cam/model/ModelViewport';

vi.mock('@/cam/model/ModelViewport', { spy: true });
const workspace = vi.hoisted(() => ({ wait: null as Promise<void> | null }));
vi.mock('./WorkspaceView', async original => {
  const actual = await original<typeof import('./WorkspaceView')>();
  return {
    ...actual,
    default: (props: Parameters<typeof actual.default>[0]) => {
      if (workspace.wait) throw workspace.wait;
      return <actual.default {...props} />;
    },
  };
});

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});
const settled = () =>
  waitFor(() => expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false'), { timeout: 20_000 });

async function studio(source = createPlateDocument({ width: 200, height: 100 })) {
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={change} onFinish={vi.fn()} onCancel={() => {}} />
    </div>
  );
  await settled();
  return { latest: () => change.mock.calls.at(-1)?.[0] ?? source };
}

it('applies a value with Enter, accepts the dialog with Enter again, and leaves the view with the keyboard', async () => {
  const { latest } = await studio();
  const features = await screen.findByRole('region', { name: 'Features' });
  await userEvent.dblClick(within(features).getByRole('button', { name: /Extrude · Plate/ }));
  const dialog = await screen.findByRole('dialog', { name: /^Extrude/ });
  const thickness = within(dialog).getByRole('textbox', { name: /Thickness/ });
  await userEvent.clear(thickness);
  await userEvent.type(thickness, '40{Enter}');
  await waitFor(() => expect(latest().parts[0]!.thickness).toBe(40));
  // Applying the value keeps the field: Enter again accepts the dialog.
  await waitFor(() => expect(document.activeElement).toBe(thickness));
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Extrude/ })).toBeNull());
  // The view has the keyboard, so its shortcuts work straight away.
  await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('workspace-3d')));
  const props = () => vi.mocked(ModelViewport).mock.calls.at(-1)![0];
  await userEvent.keyboard('p');
  await waitFor(() => expect(props().planes ?? []).toHaveLength(0));
});

it('cancels the dialog with Escape, putting back the value applied in it', async () => {
  const { latest } = await studio();
  const features = await screen.findByRole('region', { name: 'Features' });
  const before = latest().parts[0]!.thickness;
  await userEvent.dblClick(within(features).getByRole('button', { name: /Extrude · Plate/ }));
  const dialog = await screen.findByRole('dialog', { name: /^Extrude/ });
  await userEvent.clear(within(dialog).getByRole('textbox', { name: /Thickness/ }));
  await userEvent.type(within(dialog).getByRole('textbox', { name: /Thickness/ }), '70{Enter}');
  await waitFor(() => expect(latest().parts[0]!.thickness).toBe(70));
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Extrude/ })).toBeNull());
  await waitFor(() => expect(latest().parts[0]!.thickness).toBe(before));
});

it('returns the keyboard to the view after accepting a dialog while animation frames are paused', async () => {
  const { latest } = await studio();
  const features = await screen.findByRole('region', { name: 'Features' });
  await userEvent.dblClick(within(features).getByRole('button', { name: /Extrude · Plate/ }));
  const dialog = await screen.findByRole('dialog', { name: /^Extrude/ });
  const thickness = within(dialog).getByRole('textbox', { name: /Thickness/ });
  await userEvent.clear(thickness);
  // CI runs several browser pages; a background page need not render another frame.
  const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
  try {
    await userEvent.type(thickness, '40{Enter}');
    await waitFor(() => expect(latest().parts[0]!.thickness).toBe(40));
    await waitFor(() => expect(document.activeElement).toBe(thickness));
    await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Extrude/ })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('workspace-3d')));
    await userEvent.keyboard('p');
    await waitFor(() => expect(vi.mocked(ModelViewport).mock.calls.at(-1)![0].planes ?? []).toHaveLength(0));
  } finally {
    frame.mockRestore();
  }
});

it('keeps the keyboard request when Enter accepts a dialog before the lazy view has mounted', async () => {
  let ready!: () => void;
  workspace.wait = new Promise<void>(resolve => {
    ready = resolve;
  });
  try {
    const { latest } = await studio();
    const features = await screen.findByRole('region', { name: 'Features' });
    await userEvent.dblClick(within(features).getByRole('button', { name: /Extrude · Plate/ }));
    const dialog = await screen.findByRole('dialog', { name: /^Extrude/ });
    const thickness = within(dialog).getByRole('textbox', { name: /Thickness/ });
    await userEvent.clear(thickness);
    await userEvent.type(thickness, '40{Enter}');
    await waitFor(() => expect(latest().parts[0]!.thickness).toBe(40));
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Extrude/ })).toBeNull());
    expect(screen.queryByTestId('workspace-3d')).toBeNull();
    // Resolving a lazy child does not render the editor again or change its busy state.
    workspace.wait = null;
    ready();
    const view = await screen.findByTestId('workspace-3d');
    await waitFor(() => expect(document.activeElement).toBe(view));
    await userEvent.keyboard('p');
    await waitFor(() => expect(vi.mocked(ModelViewport).mock.calls.at(-1)![0].planes ?? []).toHaveLength(0));
  } finally {
    workspace.wait = null;
    ready();
  }
});
