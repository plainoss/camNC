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

it('shows the whole design with Final while a step before the last is edited', async () => {
  const source = createPlateDocument({ width: 200, height: 100 });
  source.parts.push({ ...createPlateDocument({ width: 50, height: 50 }).parts[0]!, name: 'Second' });
  await studio(source);
  await screen.findByTestId('workspace-3d', undefined, { timeout: 10_000 });
  const props = () => vi.mocked(ModelViewport).mock.calls.at(-1)![0];
  await waitFor(() => expect(props().meshes).toHaveLength(2));
  const features = screen.getByRole('region', { name: 'Features' });
  await userEvent.dblClick(within(features).getByRole('button', { name: /Extrude · Plate/ }));
  const dialog = await screen.findByRole('dialog', { name: /^Extrude/ });
  // Edited, the design shows only as far as this step.
  await waitFor(() => expect(props().meshes).toHaveLength(1));
  const final = within(dialog).getByRole('button', { name: 'Final' });
  await userEvent.click(final);
  await waitFor(() => expect(props().meshes).toHaveLength(2));
  expect(final.getAttribute('aria-pressed')).toBe('true');
  await userEvent.click(final);
  await waitFor(() => expect(props().meshes).toHaveLength(1));
  // The last step has nothing after it to show.
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await userEvent.dblClick(within(features).getByRole('button', { name: /Extrude · Second/ }));
  expect(within(await screen.findByRole('dialog', { name: /^Extrude/ })).queryByRole('button', { name: 'Final' })).toBeNull();
});
