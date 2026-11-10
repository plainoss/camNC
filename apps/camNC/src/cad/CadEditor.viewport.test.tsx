import '@/style.css';
import { createPlateDocument } from '@wbcnc/cad';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { page, userEvent } from '@vitest/browser/context';
import { afterEach, describe, expect, it } from 'vitest';
import { CamPage } from '@/cam/CamPage';
import { CadEditor } from './CadEditor';
import { endCadSession } from '@wbcnc/cad-editor/session';

const initialViewport = { width: window.innerWidth, height: window.innerHeight };
const sessions: string[] = [];
afterEach(async () => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
  await page.viewport(initialViewport.width, initialViewport.height);
});

describe.each([true, false])('Design viewport (studio: %s)', studio => {
  it('keeps tools inside the page and session actions visible beside the scrolling tools', async () => {
    const source = createPlateDocument();
    sessions.push(source.id);
    render(
      <CamPage className="h-app">
        <div className="relative min-h-0 flex-1">
          <CadEditor document={source} startIn3D={studio} onDraftChange={() => {}} onFinish={() => {}} onCancel={() => {}} />
        </div>
      </CamPage>
    );
    const toolbar = await screen.findByRole('toolbar', { name: studio ? 'Part Studio toolbar' : 'Sketch toolbar' });
    // The 3D workspace and its controls load separately from the toolbar.
    if (studio) await screen.findByRole('group', { name: 'Workspace view' }, { timeout: 20_000 });
    for (const width of [320, 390, 600, 768, 980, 1440]) {
      await page.viewport(width, 720);
      await waitFor(() => {
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
        const actions = screen.getByRole('group', { name: studio ? 'Design actions' : 'Sketch actions' });
        const bounds = actions.getBoundingClientRect();
        expect(bounds.left).toBeGreaterThanOrEqual(0);
        expect(bounds.right).toBeLessThanOrEqual(width);
        expect(bounds.bottom).toBeLessThanOrEqual(toolbar.getBoundingClientRect().bottom);
        expect(toolbar.closest('.cam-page')!.getBoundingClientRect().bottom).toBe(width < 768 ? 664 : 720);
        if (studio) {
          const views = screen.getByRole('group', { name: 'Workspace view' }).getBoundingClientRect();
          const drawing = toolbar.closest('.cad-editor')!.querySelector('.cad-drawing')!.getBoundingClientRect();
          expect(views.left).toBeGreaterThanOrEqual(drawing.left);
          expect(views.right).toBeLessThanOrEqual(drawing.right);
        }
      });
    }
    await page.viewport(390, 720);
    if (studio) {
      const height = toolbar.getBoundingClientRect().height;
      const input = toolbar.querySelector<HTMLInputElement>('input[type="file"]')!;
      fireEvent.change(input, { target: { files: [new File(['{'], 'broken.json', { type: 'application/json' })] } });
      await screen.findByRole('alert', {}, { timeout: 20_000 });
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
      expect(toolbar.getBoundingClientRect().height).toBe(height);
    }
    // Keyboard navigation must still reach commands beyond the scroll region's visible edge.
    const tools = screen.getByRole('group', { name: studio ? 'Part Studio features' : 'Sketch tools' });
    const lastTool = tools.querySelectorAll('button');
    const last = lastTool[lastTool.length - 1]!;
    last.focus();
    await waitFor(() => expect(last.getBoundingClientRect().right).toBeLessThanOrEqual(tools.getBoundingClientRect().right + 1));
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Search tools/ }));
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('combobox', { name: 'Search tools' })).toBeTruthy();
  }, 30_000);
});
