import { addCircle, addRectangle, createCadDocument, createCadPart, createPlateDocument, isCadPart, type CadDocument } from '@wbcnc/cad';
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

async function studio(source: CadDocument) {
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={change} onFinish={async () => {}} onCancel={() => {}} />
    </div>
  );
  await settled();
  return { latest: () => change.mock.calls.at(-1)?.[0] ?? source };
}

/** A sketch on Top, not yet extruded, of a rectangle and a circle, overlapping or apart. */
function sketchOf(circleX: number): CadDocument {
  const arm = { ...createCadPart('Arm', 18), drawnOn: { on: { plane: 'top' as const }, offset: 0 }, extrude: false as const };
  arm.sketch = addRectangle(arm.sketch, { x: 0, y: 0, width: 80, height: 40 });
  arm.sketch = addCircle(arm.sketch, { x: circleX, y: 20, radius: 20 });
  // A part already made, so the design opens in the studio rather than in its first sketch.
  const base = { ...createPlateDocument({ width: 50, height: 50 }).parts[0]!, name: 'Base' };
  base.placement = { position: [0, -200, 0], rotation: [0, 0, 0, 1] };
  return { ...createCadDocument(), parts: [base, arm] };
}

it('extrudes a sketch of overlapping shapes, all its regions picked, into one part', async () => {
  const { latest } = await studio(sketchOf(80));
  const features = await screen.findByRole('region', { name: 'Features' });
  await userEvent.click(within(features).getByRole('button', { name: /Sketch · Arm/ }));
  await userEvent.keyboard('{Shift>}E{/Shift}');
  const dialog = await screen.findByRole('dialog', { name: /^Extrude/ });
  expect(within(dialog).queryByRole('alert')).toBeNull();
  expect(within(dialog).getByText(/3 regions/)).toBeDefined();
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(latest().parts.filter(isCadPart)).toHaveLength(2));
  expect(screen.queryByText('Finish is blocked')).toBeNull();
});

it('extrudes a sketch of two separate outlines into two parts', async () => {
  const { latest } = await studio(sketchOf(150));
  const features = await screen.findByRole('region', { name: 'Features' });
  await userEvent.click(within(features).getByRole('button', { name: /Sketch · Arm/ }));
  await userEvent.keyboard('{Shift>}E{/Shift}');
  const dialog = await screen.findByRole('dialog', { name: /^Extrude/ });
  expect(within(dialog).queryByRole('alert')).toBeNull();
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(latest().parts.filter(isCadPart)).toHaveLength(3));
});

it('flips an extrude to the other side of its sketch’s plane', async () => {
  const { latest } = await studio(sketchOf(80));
  const features = await screen.findByRole('region', { name: 'Features' });
  await userEvent.click(within(features).getByRole('button', { name: /Sketch · Arm/ }));
  await userEvent.keyboard('{Shift>}E{/Shift}');
  const dialog = await screen.findByRole('dialog', { name: /^Extrude/ });
  const flip = within(dialog).getByRole('button', { name: 'Flip direction' });
  await userEvent.click(flip);
  await waitFor(() => expect(latest().parts[1]!.drawnOn!.inward).toBe(true));
  expect(flip.getAttribute('aria-pressed')).toBe('true');
  await userEvent.click(flip);
  await waitFor(() => expect(latest().parts[1]!.drawnOn!.inward).toBeUndefined());
});
