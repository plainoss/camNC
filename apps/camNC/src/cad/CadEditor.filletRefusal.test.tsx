import { createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from '@wbcnc/cad-editor/session';

vi.mock('@/cam/model/ModelViewport', { spy: true });

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});
const settled = () =>
  waitFor(() => expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false'), { timeout: 20_000 });
const message =
  'A fillet on Part 1 can’t be made at 2 of its 3 corners: This radius would consume an entire adjacent line. Choose a smaller radius.';

/** A 400 mm wide plate with three corners rounded, two of them sharing its right side. */
function design(height: number, radius: number): CadDocument {
  const source = createPlateDocument({ width: 400, height });
  const part = source.parts[0]!;
  const corner = (x: number, y: number) =>
    part.sketch.entities.find(e => e.type === 'point' && Math.abs(e.x - x) < 1e-6 && Math.abs(e.y - y) < 1e-6)!.id;
  part.name = 'Part 1';
  part.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  part.fillets = [{ id: 'fillet', corners: [corner(0, 0), corner(400, 0), corner(400, height)], radius }];
  sessions.push(source.id);
  return source;
}

function open(source: CadDocument, change: (document: CadDocument) => void = () => {}) {
  render(
    <div style={{ height: 800, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  return settled();
}

it('says in the Fillet dialog, as it previews, that a radius uses up a side, and won’t keep it', async () => {
  const source = design(250, 30);
  const change = vi.fn<(document: CadDocument) => void>();
  await open(source, change);
  const features = screen.getByRole('region', { name: 'Features' });
  await userEvent.dblClick(within(features).getByRole('button', { name: /^Fillet · Part 1/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Fillet' });
  expect(within(dialog).queryByRole('alert')).toBeNull();
  const radius = within(dialog).getByRole('textbox', { name: 'Radius' });
  await userEvent.clear(radius);
  await userEvent.type(radius, '125');
  await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toBe(message));
  const ok = within(dialog).getByRole('button', { name: 'OK' });
  expect(ok).toHaveProperty('disabled', true);
  expect(ok.getAttribute('aria-description')).toBe(message);
  // A radius every corner can take is fine again.
  await userEvent.clear(radius);
  await userEvent.type(radius, '124');
  await waitFor(() => expect(within(dialog).queryByRole('alert')).toBeNull());
  expect(within(dialog).getByRole('button', { name: 'OK' })).toHaveProperty('disabled', false);
}, 30_000);

it('marks the Fillet row and the part when the sketch shrinks under its radius', async () => {
  await open(design(50, 30));
  const features = screen.getByRole('region', { name: 'Features' });
  const step = within(features).getByRole('button', { name: /^Fillet · Part 1/ });
  expect(within(step).getByRole('img', { name: 'Error' }).getAttribute('title')).toBe(message);
  expect(within(features).getByRole('status', { name: '1 with errors' })).toBeDefined();
  const parts = within(screen.getByRole('list', { name: 'Parts' }));
  expect(within(parts.getByRole('button', { name: /^▱?\s*Part 1/ })).getByRole('img', { name: message })).toBeDefined();
}, 30_000);
