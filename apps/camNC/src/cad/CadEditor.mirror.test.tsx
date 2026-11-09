import { createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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

it('mirrors the selected part across a picked plane, and changes the plane from its step', async () => {
  const source = createPlateDocument({ width: 100, height: 60 });
  source.parts[0]!.placement = { position: [30, 0, 0], rotation: [0, 0, 0, 1] };
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={change} onFinish={vi.fn()} onCancel={() => {}} />
    </div>
  );
  await settled();
  const latest = () => change.mock.calls.at(-1)?.[0] ?? source;
  const toolbar = await screen.findByRole('toolbar', { name: 'Part Studio toolbar' });
  const features = screen.getByRole('region', { name: 'Features' });
  const geometry = within(features).getByRole('list', { name: 'Default geometry' });
  await userEvent.click(within(toolbar).getByRole('button', { name: /^Mirror/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Mirror' });
  // The mirror plane is picked straight away.
  expect(within(dialog).getByRole('button', { name: 'Mirror plane' }).hasAttribute('data-active')).toBe(true);
  await userEvent.click(within(geometry).getByRole('button', { name: /Right/ }));
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Mirror plane' }).textContent).toContain('right plane'));
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(latest().parts[0]!.copies).toHaveLength(1));
  const copy = latest().parts[0]!.copies![0]!;
  expect(copy).toMatchObject({ mirrored: true, mirror: { across: { plane: 'right' } } });
  await waitFor(() => expect(latest().parts[0]!.copies![0]!.placement!.position[0]).toBeCloseTo(-30, 6));
  // Its step opens it again, to mirror across another plane.
  await userEvent.dblClick(await within(features).findByRole('button', { name: /Plate 2|copy|Copy/ }));
  const again = await screen.findByRole('dialog', { name: 'Mirror' });
  await userEvent.click(within(again).getByRole('button', { name: 'Mirror plane' }));
  await userEvent.click(within(geometry).getByRole('button', { name: /Front/ }));
  await userEvent.click(within(again).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(latest().parts[0]!.copies![0]!.mirror).toEqual({ across: { plane: 'front' } }));
});
