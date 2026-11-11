import { parseCadDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
const message = 'Finger count fingers = 1 in Cut Side with Front: a finger joint needs a whole number of fingers, at least 2.';

it('says on the joined parts and the Cut parts row why a finger count of 1 isn’t followed', async () => {
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
  const parts = () => within(screen.getByRole('list', { name: 'Parts' }));
  expect(within(features).queryByRole('status', { name: /with errors/ })).toBeNull();
  await userEvent.dblClick(within(features).getByRole('button', { name: /^#fingers = 5/ }));
  const variable = await screen.findByRole('dialog', { name: '#fingers' });
  const field = within(variable).getByRole('textbox', { name: 'Value' });
  await userEvent.clear(field);
  await userEvent.type(field, '1');
  await userEvent.click(within(variable).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '#fingers' })).toBeNull());
  await settled();
  // The joint keeps its last good count, and says so where it's seen rather than silently.
  expect(latest.partCuts![1]!.split).toEqual({ fingers: 5, fingersExpression: 'fingers' });
  for (const name of ['Front', 'Side'])
    expect(within(parts().getByRole('button', { name: new RegExp(`^▱?\\s*${name}`) })).getByRole('img', { name: message })).toBeDefined();
  for (const name of ['Leg A', 'Leg B'])
    expect(within(parts().getByRole('button', { name: new RegExp(`^▱?\\s*${name}`) })).queryByRole('img')).toBeNull();
  const step = within(features).getByRole('button', { name: /^Cut Side with Front/ });
  expect(within(step).getByRole('img', { name: 'Error' }).getAttribute('title')).toBe(message);
  expect(within(features).getByRole('status', { name: '1 with errors' })).toBeDefined();
});
