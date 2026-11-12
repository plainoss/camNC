import { parseCadDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from '@wbcnc/cad-editor/session';
import saved from '../../../../packages/cad-script/fixtures/designs/fitted-joints.json';

vi.mock('@/cam/model/ModelViewport', { spy: true });
let sessionId = '';
afterEach(() => {
  cleanup();
  if (sessionId) endCadSession(sessionId);
});

const settled = () =>
  waitFor(() => expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false'), { timeout: 20_000 });
const message = 'Cut Side with Front can’t use its tool Front, which isn’t extruded.';

it('says on the Cut parts row and the joined parts that the tool whose Extrude was deleted isn’t built', async () => {
  const source = parseCadDocument(structuredClone(saved));
  sessionId = source.id;
  let latest: CadDocument = source;
  render(
    <div style={{ height: 800, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={value => (latest = value)} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  await settled();
  const features = screen.getByRole('region', { name: 'Features' });
  expect(within(features).queryByRole('status', { name: /with errors/ })).toBeNull();
  fireEvent.contextMenu(within(features).getByRole('button', { name: /^Extrude · Front/ }));
  await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Delete' }));
  await waitFor(() => expect(latest.parts.find(part => part.name === 'Front')?.extrude).toBe(false));
  await settled();
  // The step still names Front as its tool, and now says it cuts without it rather than silently.
  const step = within(features).getByRole('button', { name: /^Cut Side with Front/ });
  await waitFor(() => expect(within(step).getByRole('img', { name: 'Error' }).getAttribute('title')).toBe(message));
  expect(within(features).getByRole('status', { name: '1 with errors' })).toBeDefined();
  const parts = within(screen.getByRole('list', { name: 'Parts' }));
  expect(within(parts.getByRole('button', { name: /^▱?\s*Side/ })).getByRole('img', { name: message })).toBeDefined();
});
