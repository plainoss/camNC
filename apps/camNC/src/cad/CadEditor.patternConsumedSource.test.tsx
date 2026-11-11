import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { addPartCut, addRectangle, consumedTools, createCadDocument, createCadPart, type CadDocument } from '@wbcnc/cad';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { afterEach, expect, it } from 'vitest';
import { CadEditor } from './CadEditor';
import { solveCadDocument } from './solveCad';
import { studioCommand } from './studioToolbarTesting';

let sessionId: string | undefined;
afterEach(() => {
  cleanup();
  if (sessionId) endCadSession(sessionId);
  sessionId = undefined;
});

it('patterns an explicitly selected consumed source while retaining its cut and physical membership', async () => {
  const base = createCadPart('Base', 12),
    tool = createCadPart('Tool', 12);
  for (const [part, x, y, width, height] of [
    [base, 0, 0, 100, 100],
    [tool, 30, 30, 20, 20],
  ] as const) {
    part.sketch = addRectangle(part.sketch, { x, y, width, height, dimensioned: true, positioned: true });
    part.drawnOn = { on: { plane: 'top' }, offset: 0 };
  }
  const cut = addPartCut({ ...createCadDocument(), parts: [base, tool] }, [tool.id], [base.id], { value: 0 }).document;
  cut.partCuts![0]!.consumeTools = true;
  const source = (await solveCadDocument(cut)).document;
  sessionId = source.id;
  let current = source;
  const changed = (next: CadDocument) => {
    current = next;
  };
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={changed} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  await screen.findByTestId('workspace-3d', {}, { timeout: 20_000 });
  await waitFor(() => expect(document.querySelector('.cad-editor')).toHaveAttribute('aria-busy', 'false'), { timeout: 20_000 });
  await waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20_000 });
  const parts = within(screen.getByRole('list', { name: 'Parts' }));
  expect(consumedTools(current).has(tool.id)).toBe(true);
  expect(parts.queryByRole('button', { name: /^Tool(?: |$)/ })).toBeNull();
  const before = structuredClone(current);
  const features = within(screen.getByRole('region', { name: 'Features' }));
  await userEvent.click(features.getByRole('button', { name: /^Extrude · Tool/ }));
  const pattern = await studioCommand(/Pattern/);
  expect(pattern).not.toBeDisabled();
  await userEvent.click(pattern);
  expect(screen.queryAllByRole('alert').map(alert => alert.textContent)).toEqual([]);
  const dialog = await screen.findByRole('dialog', { name: 'Linear pattern · Tool' });
  expect(within(dialog).getByRole('textbox', { name: 'How many' })).toHaveValue('2');
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(current.parts.find(part => part.id === tool.id)?.pattern?.count).toBe(2));
  const family = current.parts.find(part => part.id === tool.id)!;
  expect(family.id).toBe(tool.id);
  expect(family.sketch.id).toBe(tool.sketch.id);
  expect(family.copies).toHaveLength(1);
  expect(family.copies![0]!.pattern).toBe(family.pattern!.id);
  expect(new Set([family.id, family.copies![0]!.id]).size).toBe(2);
  expect(current.parts.map(part => part.id)).toEqual(before.parts.map(part => part.id));
  expect(current.parts.find(part => part.id === base.id)).toEqual(before.parts.find(part => part.id === base.id));
  expect(current.partCuts).toEqual(before.partCuts);
  expect(consumedTools(current).has(tool.id)).toBe(true);
  expect(parts.queryByRole('button', { name: /^Tool(?: |$)/ })).toBeNull();
  expect(parts.getByRole('button', { name: /^Base(?: |$)/ })).toBeTruthy();
  // Consumption hides the family physically but must not reset its history or copy slots on another source edit.
  const patternId = family.pattern!.id,
    copyIds = family.copies!.map(copy => copy.id);
  await userEvent.click(features.getByRole('button', { name: /^Extrude · Tool/ }));
  await userEvent.click(await studioCommand(/Pattern/));
  const reopened = await screen.findByRole('dialog', { name: 'Linear pattern · Tool' });
  expect(within(reopened).getByRole('textbox', { name: 'How many' })).toHaveValue('2');
  await userEvent.click(within(reopened).getByRole('button', { name: 'OK' }));
  const retained = current.parts.find(part => part.id === tool.id)!;
  expect(retained.pattern!.id).toBe(patternId);
  expect(retained.copies!.map(copy => copy.id)).toEqual(copyIds);
  expect(consumedTools(current).has(tool.id)).toBe(true);
  expect(current.partCuts).toEqual(before.partCuts);
});
