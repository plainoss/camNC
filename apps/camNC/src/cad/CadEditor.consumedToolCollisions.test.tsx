import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { parseCadDocument, type CadDocument } from '@wbcnc/cad';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import cabinet from '../../../../packages/cad-script/fixtures/designs/cabinet-consumed-cable-chase.json';

let session: string | undefined;
afterEach(() => {
  cleanup();
  if (session) endCadSession(session);
  session = undefined;
});
const collisions = 'Bottom and Cable chase, Top and Cable chase, Shelf and Cable chase, Shelf 2 and Cable chase take up the same space.';
const ready = async () => {
  await screen.findByTestId('workspace-3d', {}, { timeout: 20_000 });
  await waitFor(() => expect(document.querySelector('.cad-editor')).toHaveAttribute('aria-busy', 'false'), { timeout: 20_000 });
  await waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20_000 });
};

it('keeps the complete cabinet collision footer consistent with consumed membership through Keep tools and Undo', async () => {
  const source = parseCadDocument(structuredClone(cabinet));
  session = source.id;
  const changed = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={changed} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  const latest = () => changed.mock.calls.at(-1)?.[0] ?? source;
  await ready();
  const before = structuredClone(latest());
  const parts = () => within(screen.getByRole('list', { name: 'Parts' }));
  expect(parts().getAllByRole('listitem')).toHaveLength(8);
  expect(parts().queryByRole('button', { name: 'Cable chase' })).toBeNull();
  expect(screen.queryByText(/take up the same space/)).toBeNull();
  const feature = () =>
    within(screen.getByRole('region', { name: 'Features' })).getByRole('button', { name: /^Cut Shelf 3 with Cable chase/ });
  await userEvent.dblClick(feature());
  let dialog = await screen.findByRole('dialog', { name: 'Cut parts' });
  expect(within(dialog).getByRole('checkbox', { name: 'Keep tools' })).not.toBeChecked();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await ready();
  expect(latest().partCuts).toEqual(before.partCuts);
  expect(screen.queryByText(/take up the same space/)).toBeNull();

  await userEvent.dblClick(feature());
  dialog = await screen.findByRole('dialog', { name: 'Cut parts' });
  await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Keep tools' }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Cut parts' })).toBeNull());
  await ready();
  await waitFor(() => expect(parts().getAllByRole('listitem')).toHaveLength(9));
  expect(parts().getByRole('button', { name: 'Cable chase' })).toBeTruthy();
  expect(screen.getByText(collisions)).toBeTruthy();
  expect(latest().parts).toEqual(before.parts);
  expect(latest().partCuts!.at(-1)!.targets).toEqual(before.partCuts!.at(-1)!.targets);

  await userEvent.click(within(screen.getByRole('toolbar', { name: 'Part Studio toolbar' })).getByRole('button', { name: /^Undo/ }));
  await ready();
  await waitFor(() => expect(parts().getAllByRole('listitem')).toHaveLength(8));
  expect(screen.queryByText(/take up the same space/)).toBeNull();
  expect(latest().parts).toEqual(before.parts);
  expect(latest().partCuts).toEqual(before.partCuts);
  // Source history remains reachable although the construction tool is no longer physical.
  await userEvent.click(within(screen.getByRole('region', { name: 'Features' })).getByRole('button', { name: /^Extrude · Cable chase/ }));
  expect(
    within(screen.getByRole('toolbar', { name: 'Part Studio toolbar' })).getByRole('button', { name: /Transform/ })
  ).not.toBeDisabled();
}, 40_000);
