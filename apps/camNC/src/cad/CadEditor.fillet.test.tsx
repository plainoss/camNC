import { createPlateDocument, evaluateCadPart, polygonArea, type CadDocument } from '@wbcnc/cad';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
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

it('rounds the edges through a part picked in the view, and refuses a top edge', async () => {
  const source = createPlateDocument({ width: 100, height: 60 });
  source.parts[0]!.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={change} onFinish={vi.fn()} onCancel={() => {}} />
    </div>
  );
  await settled();
  const latest = () => change.mock.calls.at(-1)?.[0] ?? source;
  await screen.findByTestId('workspace-3d', undefined, { timeout: 10_000 });
  const props = () => vi.mocked(ModelViewport).mock.calls.at(-1)![0];
  await userEvent.click(within(screen.getByRole('toolbar', { name: 'Part Studio toolbar' })).getByRole('button', { name: /^Fillet/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Fillet' });
  const click = (a: [number, number, number], b: [number, number, number]) =>
    act(() => props().onSelect(source.parts[0]!.id, 0, { point: a, normal: [1, 0, 0], edge: { a, b } } as never));
  // An edge along the top can't be rounded with a straight bit.
  await click([0, 60, 18], [100, 60, 18]);
  expect(within(dialog).getByRole('alert').textContent).toMatch(/roundover/);
  // The edges through the board at two corners.
  await click([100, 60, 0], [100, 60, 18]);
  await click([0, 0, 18], [0, 0, 0]);
  expect(within(dialog).getByText(/2 edges of Plate/)).toBeDefined();
  await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Radius' }));
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Radius' }), '10');
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(latest().parts[0]!.fillets).toMatchObject([{ radius: 10 }]));
  expect(latest().parts[0]!.fillets![0]!.corners).toHaveLength(2);
  expect(Math.abs(polygonArea(evaluateCadPart(latest().parts[0]!).part!.outline))).toBeCloseTo(6000 - 2 * (100 - 25 * Math.PI), 0);
  expect(within(screen.getByRole('region', { name: 'Features' })).getByRole('button', { name: /Fillet · Plate/ })).toBeDefined();
});
