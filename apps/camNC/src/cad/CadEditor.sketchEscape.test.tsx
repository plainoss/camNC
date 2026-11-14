import { createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { settled } from '@/test/settled';

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});

// Escape from a step dialog's part pick must not reach an open sketch: on the drawing it ends the tool, and the sketch stays open.
it('ends a sketch tool with Escape and keeps the Part Studio sketch open', async () => {
  const source = createPlateDocument({ width: 200, height: 100 });
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={change} onFinish={vi.fn()} onCancel={vi.fn()} />
    </div>
  );
  await waitFor(() => expect(document.querySelector('.cad-editor')).toHaveAttribute('aria-busy', 'false'), { timeout: 20_000 });
  await settled();
  await userEvent.dblClick(within(screen.getByRole('region', { name: 'Features' })).getByRole('button', { name: /^Sketch( ·| \d)/ }));
  const sketch = await screen.findByRole('dialog', { name: /^Sketch( · | \d)/ });
  await settled();
  const canvas = screen.getByTestId('cad-canvas');
  canvas.focus();
  await userEvent.keyboard('l');
  await waitFor(() => expect(canvas.getAttribute('class')).toContain('cad-tool-line'));
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(canvas.getAttribute('class')).toContain('cad-tool-select'));
  await settled();
  expect(screen.getByRole('dialog', { name: /^Sketch( · | \d)/ })).toBe(sketch);
  expect(screen.getByTestId('cad-canvas')).toBe(canvas);
});
