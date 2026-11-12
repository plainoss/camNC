import '@/style.css';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { page, userEvent } from '@vitest/browser/context';
import { parseCadDocument } from '@wbcnc/cad';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { afterEach, expect, it } from 'vitest';
import { CamPage } from '@/cam/CamPage';
import { CadEditor } from './CadEditor';
import { solveCadDocument } from './solveCad';
import tray from '../../../../packages/cad-script/fixtures/designs/divided-tray.json';
import { studioCommand } from './studioToolbarTesting';

const initialViewport = { width: window.innerWidth, height: window.innerHeight };
const viewports = [
  [1440, 1000],
  [1280, 720],
  [1024, 768],
  [900, 720],
  [600, 720],
  [390, 720],
  [320, 720],
] as const;
const sessions: string[] = [];
afterEach(async () => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
  await page.viewport(initialViewport.width, initialViewport.height);
});

it('keeps every word of copy-transform recovery guidance clear of workspace controls as the viewport narrows', async () => {
  await page.viewport(1440, 1000);
  const source = (await solveCadDocument(parseCadDocument(structuredClone(tray)))).document;
  sessions.push(source.id);
  render(
    <CamPage className="h-app">
      <div className="relative min-h-0 flex-1">
        <CadEditor document={source} startIn3D onDraftChange={() => {}} onFinish={() => {}} onCancel={() => {}} />
      </div>
    </CamPage>
  );
  // Toolbar readiness alone does not guarantee the lazy workspace controls or solved physical copies are present.
  await screen.findByRole('group', { name: 'Workspace view' }, { timeout: 20_000 });
  await waitFor(() => expect(document.querySelector('.cad-editor')).toHaveAttribute('aria-busy', 'false'), { timeout: 20_000 });
  await userEvent.click(within(screen.getByRole('list', { name: 'Parts' })).getByRole('button', { name: /^Divider 3(?: |$)/ }));
  await userEvent.click(await studioCommand(/Transform/));
  const alert = screen.getByRole('alert');
  expect(alert.textContent).toBe(
    'Transforming only the selected copy is not supported. Select the source part in Parts to transform its whole family.'
  );
  for (const [width, height] of viewports) {
    await page.viewport(width, height);
    await waitFor(() => {
      const bounds = alert.getBoundingClientRect();
      const drawing = document.querySelector('.cad-drawing')!.getBoundingClientRect();
      expect(bounds.width).toBeGreaterThan(0);
      expect(bounds.left).toBeGreaterThanOrEqual(drawing.left);
      expect(bounds.right).toBeLessThanOrEqual(Math.min(drawing.right, width));
      expect(bounds.top).toBeGreaterThanOrEqual(drawing.top);
      expect(bounds.bottom).toBeLessThanOrEqual(Math.min(drawing.bottom, height));
      expect(alert.scrollWidth).toBeLessThanOrEqual(alert.clientWidth);
      expect(alert.scrollHeight).toBeLessThanOrEqual(alert.clientHeight);
      const text = document.createRange();
      text.selectNodeContents(alert);
      for (const line of text.getClientRects()) {
        expect(line.left).toBeGreaterThanOrEqual(bounds.left);
        expect(line.right).toBeLessThanOrEqual(bounds.right);
        expect(line.top).toBeGreaterThanOrEqual(bounds.top);
        expect(line.bottom).toBeLessThanOrEqual(bounds.bottom);
      }
      const controls = [screen.getByRole('group', { name: 'Workspace view' }), screen.getByRole('combobox', { name: 'Display' })];
      for (const control of controls) {
        const other = control.getBoundingClientRect();
        expect(bounds.left < other.right && bounds.right > other.left && bounds.top < other.bottom && bounds.bottom > other.top).toBe(
          false
        );
      }
    });
  }
}, 30_000);
