import { createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { page, userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { CadEditor } from './CadEditor';
import { ModelViewport } from '@/cam/model/ModelViewport';

vi.mock('@/cam/model/ModelViewport', { spy: true });
let sessionId = '';
// Each workflow includes the renderer's up-to-20s readiness checks and native pointer actions.
const kViewportWorkflowTimeout = 40_000;
afterEach(async () => {
  cleanup();
  if (sessionId) endCadSession(sessionId);
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
  await waitFor(() => expect(document.querySelector('.cad-editor')).toHaveAttribute('aria-busy', 'false'), { timeout: 20000 });
  // Wait for the lazy workspace itself before the separate camera readiness check.
  const frame = await screen.findByTestId('workspace-3d', {}, { timeout: 20000 });
  const props = () => vi.mocked(ModelViewport).mock.calls.findLast(([props]) => props.cameraState)![0];
  // The lazy Canvas publishes its first camera frame after shader/context startup, which can outlast a second under suite load.
  await waitFor(() => expect(props().cameraState!.current).not.toBeNull(), { timeout: 20000 });
  const view = async (digit: number, z: number) => {
    frame.focus();
    await userEvent.keyboard(`{Shift>}${digit}{/Shift}`);
    await waitFor(() => expect(props().cameraState!.current!.back[2]).toBeCloseTo(z, 6), { timeout: 20000 });
  };
  const click = async (point: [number, number, number]) => {
    const canvas = frame.querySelector('canvas')!;
    const camera = props().cameraState!.current!,
      box = canvas.getBoundingClientRect();
    const { back, up, center, height } = camera;
    const right = [up[1] * back[2] - up[2] * back[1], up[2] * back[0] - up[0] * back[2], up[0] * back[1] - up[1] * back[0]];
    const delta = point.map((v, i) => v - center[i]!);
    const dot = (v: number[]) => v.reduce((sum, n, i) => sum + n * delta[i]!, 0);
    await userEvent.click(canvas, {
      position: { x: box.width / 2 + (dot(right) * box.height) / height, y: box.height / 2 - (dot(up) * box.height) / height },
    });
  };
  return { source, change, frame, view, click };
}

it(
  'measures actual opposite stock faces with native viewport picks and keeps document/history unchanged',
  async () => {
    const { source, change, view, click } = await setup();
    await view(5, 1);
    await click([50, 30, 18]);
    const quick = await screen.findByRole('region', { name: 'Selection measurements' });
    expect(within(quick).getByRole('button', { name: 'Area: 6000 mm²' })).toBeVisible();
    await userEvent.click(within(quick).getByRole('button', { name: 'Measure [' }));
    const dialog = await screen.findByRole('dialog', { name: 'Measure' });
    await view(6, -1);
    await click([50, 30, 0]);
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Min distance: 18 mm' })).toBeVisible());
    expect(within(dialog).getByRole('list', { name: 'Measured entities' }).children).toHaveLength(2);
    expect(within(dialog).getByRole('button', { name: 'Angle: 180°' })).toBeVisible();
    expect(await screen.findByTestId('measurement-witness')).toBeInTheDocument();
    expect(change.mock.calls.at(-1)?.[0] ?? source).toEqual(source);
    expect(screen.getByRole('button', { name: 'Undo (Ctrl or Command Z)' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close Measure' }));
    expect(screen.queryByRole('dialog', { name: 'Measure' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Selection measurements' })).toBeVisible();
  },
  kViewportWorkflowTimeout
);

it(
  'uses real corners and edges and clears selections on empty space',
  async () => {
    const { view, click, frame } = await setup();
    await view(5, 1);
    await click([50, 0, 18]);
    const quick = await screen.findByRole('region', { name: 'Selection measurements' });
    expect(within(quick).getByRole('button', { name: 'Length: 100 mm' })).toBeVisible();
    frame.focus();
    await userEvent.keyboard('[BracketLeft]');
    const dialog = await screen.findByRole('dialog', { name: 'Measure' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Clear' }));
    await click([0.2, 0.2, 18]);
    await click([99.8, 59.8, 18]);
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /^Distance: 116\.619 mm$/ })).toBeVisible());
    expect(within(dialog).getByRole('list', { name: 'Measured entities' })).toHaveTextContent('vertex');
    const canvas = frame.querySelector('canvas')!;
    await userEvent.click(canvas, { position: { x: 10, y: 80 } });
    expect(within(dialog).queryByRole('list', { name: 'Measured entities' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Clear' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close Measure' }));
  },
  kViewportWorkflowTimeout
);

it(
  'adds a second quick measurement pick with Shift without opening the source sketch',
  async () => {
    const { view, click } = await setup();
    await view(5, 1);
    await click([0.2, 0.2, 18]);
    await userEvent.keyboard('{Shift>}');
    await click([99.8, 59.8, 18]);
    await userEvent.keyboard('{/Shift}');
    const quick = await screen.findByRole('region', { name: 'Selection measurements' });
    expect(within(quick).getByRole('button', { name: 'Distance: 116.619 mm' })).toBeVisible();
    expect(screen.queryByRole('dialog', { name: /^Sketch/ })).toBeNull();
    expect(screen.getByTestId('workspace-3d')).toBeVisible();
    await click([50, 30, 18]);
    expect(screen.queryByRole('dialog', { name: /^Sketch/ })).toBeNull();
  },
  kViewportWorkflowTimeout
);

it(
  'clears geometry picks when the Parts list selects a body, keeping the inspector open',
  async () => {
    const { view, click } = await setup();
    await view(5, 1);
    await click([50, 30, 18]);
    await userEvent.click(screen.getByRole('button', { name: 'Measure [' }));
    const dialog = await screen.findByRole('dialog', { name: 'Measure' });
    await userEvent.click(screen.getByTitle('Hide Top in the view'));
    expect(within(dialog).getByRole('button', { name: 'Area: 6000 mm²' })).toBeVisible();
    const row = within(screen.getByRole('list', { name: 'Parts' }))
      .getByText('Plate', { exact: true })
      .closest('button')!;
    await userEvent.click(row);
    expect(within(dialog).queryByRole('list', { name: 'Measured entities' })).toBeNull();
    expect(dialog).toBeVisible();
  },
  kViewportWorkflowTimeout
);
