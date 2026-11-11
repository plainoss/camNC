import { createPlateDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from '@wbcnc/cad-editor/session';

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});

async function studio() {
  const source = createPlateDocument({ width: 200, height: 100 });
  sessions.push(source.id);
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={() => {}} onFinish={async () => {}} onCancel={() => {}} />
    </div>
  );
  await waitFor(() => expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false'), { timeout: 20_000 });
  return screen.getByRole('group', { name: 'Part Studio features' });
}

it('does not run the editor shortcut of a key typed in the More menu', async () => {
  const features = await studio();
  await userEvent.click(within(features).getByRole('button', { name: /^More/ }));
  await screen.findByRole('menu');
  // Shift+S starts a sketch in the studio; inside the menu it is only typeahead.
  await userEvent.keyboard('{Shift>}S{/Shift}');
  expect(screen.queryByRole('dialog', { name: /^Sketch/ })).toBeNull();
  expect(screen.getByRole('menu')).toBeTruthy();
});
