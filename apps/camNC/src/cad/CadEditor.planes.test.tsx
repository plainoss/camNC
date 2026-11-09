import { createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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

it('makes a plane offset from a base plane, sketches on it, and what’s drawn on it follows when it changes', async () => {
  const { latest } = await studio();
  await screen.findByTestId('workspace-3d', undefined, { timeout: 10_000 });
  const props = () => vi.mocked(ModelViewport).mock.calls.at(-1)![0];
  const toolbar = screen.getByRole('toolbar', { name: 'Part Studio toolbar' });
  const features = screen.getByRole('region', { name: 'Features' });
  const geometry = within(features).getByRole('list', { name: 'Default geometry' });

  await userEvent.click(within(toolbar).getByRole('button', { name: /^Plane/ }));
  const dialog = screen.getByRole('dialog', { name: 'Plane' });
  // The selection box starts active, so the plane clicked next is what it's offset from.
  expect(within(dialog).getByRole('button', { name: 'Plane on' }).hasAttribute('data-active')).toBe(true);
  await userEvent.click(within(geometry).getByRole('button', { name: /Top/ }));
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Plane on' }).textContent).toContain('top plane'));
  const offset = within(dialog).getByRole('textbox', { name: 'Offset' });
  await userEvent.clear(offset);
  await userEvent.type(offset, '120');
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(latest().planes).toMatchObject([{ name: 'Plane 1', on: { plane: 'top' }, offset: 120 }]));
  // It's a feature, and the view shows it with the base planes.
  const row = await within(features).findByRole('button', { name: /Plane 1/ });
  await waitFor(() => expect(props().planes?.map(plane => plane.label)).toEqual(['Top', 'Front', 'Right', 'Plane 1']));
  expect(props().planes![3]!.origin[2]).toBe(120);

  // Picked in the list, a new sketch is drawn on it.
  await userEvent.click(row);
  await waitFor(() => expect(row.getAttribute('aria-pressed')).toBe('true'));
  await userEvent.click(within(toolbar).getByRole('button', { name: /Sketch/ }));
  await waitFor(() =>
    expect(latest().parts.at(-1)!.drawnOn).toMatchObject({ on: { plane: 'top' }, offset: 120, datum: latest().planes![0]!.id })
  );
  // Nothing drawn yet, the sketch is cancelled and goes again.
  await userEvent.click(within(await screen.findByRole('dialog', { name: /^Sketch · / })).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(latest().parts).toHaveLength(1));
});

it('moves what’s drawn on a plane with it, and leaves it there when the plane is deleted', async () => {
  const source = createPlateDocument({ width: 200, height: 100 });
  const plate = source.parts[0]!;
  const shelf = { ...plate, id: 'shelf', name: 'Shelf', drawnOn: { on: { plane: 'top' as const }, offset: 120, datum: 'p1' } };
  source.parts = [plate, shelf];
  source.planes = [{ id: 'p1', name: 'Plane 1', on: { plane: 'top' }, offset: 120 }];
  const { latest } = await studio(source);
  const features = screen.getByRole('region', { name: 'Features' });
  await userEvent.dblClick(await within(features).findByRole('button', { name: /Plane 1/ }));
  const dialog = screen.getByRole('dialog', { name: 'Plane 1' });
  await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Offset' }));
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Offset' }), '200');
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(latest().parts.find(part => part.id === 'shelf')!.drawnOn!.offset).toBe(200));

  (await within(features).findByRole('button', { name: /Plane 1/ })).focus();
  await userEvent.keyboard('{Delete}');
  await waitFor(() => expect(latest().planes).toBeUndefined());
  expect(latest().parts.find(part => part.id === 'shelf')!.drawnOn).toEqual({ on: { plane: 'top' }, offset: 200 });
});
