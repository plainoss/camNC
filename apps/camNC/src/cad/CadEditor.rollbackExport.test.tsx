import { createPlateDocument } from '@wbcnc/cad';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor, type CadEditorController } from './CadEditor';

// The bar lives in the feature list; a stand-in 3D view keeps the test from waiting on the real one to load and build.
vi.mock('./WorkspaceView', () => ({ default: () => <div data-testid="workspace-3d" tabIndex={0} /> }));

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});

it('tells an export where the rollback bar is, also while a feature dialog is open', async () => {
  const source = createPlateDocument({ width: 200, height: 100 });
  const [plate] = source.parts;
  source.parts.push({ ...createPlateDocument({ width: 50, height: 50 }).parts[0]!, id: 'shelf', name: 'Shelf' });
  sessions.push(source.id);
  const controller = { current: null as CadEditorController | null };
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D controller={controller} onDraftChange={() => {}} onFinish={vi.fn()} onCancel={() => {}} />
    </div>
  );
  await waitFor(() => expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false'), { timeout: 20_000 });
  const features = await screen.findByRole('region', { name: 'Features' }, { timeout: 20_000 });
  const plateExtrude = () => within(features).getByRole('button', { name: /Extrude · Plate/ });
  await waitFor(() => expect(plateExtrude()).toBeTruthy(), { timeout: 20_000 });
  expect(controller.current!.rolledTo()).toBeNull();

  fireEvent.contextMenu(plateExtrude());
  await userEvent.click(screen.getByRole('menuitem', { name: 'Roll to here' }));
  await waitFor(() => expect(controller.current!.rolledTo()).toBe(`${plate!.id}:extrude`));

  // Editing a step moves the view's own bar to it, but the one the user set is still what an export stops at.
  fireEvent.contextMenu(plateExtrude());
  await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Edit…' }));
  await screen.findByRole('dialog', undefined, { timeout: 20_000 });
  expect(controller.current!.rolledTo()).toBe(`${plate!.id}:extrude`);
});
