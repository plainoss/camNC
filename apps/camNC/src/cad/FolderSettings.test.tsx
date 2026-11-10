import '@/style.css';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { page, userEvent } from '@vitest/browser/context';
import { parseCadDocument, type CadDocument } from '@wbcnc/cad';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { FeatureList } from './FeatureList';
import { VariableDialog } from './VariableDialog';
import cupboard from '../../../../packages/cad-script/fixtures/designs/folder-settings-cupboard.json';

const initialViewport = { width: window.innerWidth, height: window.innerHeight };
const layoutSizes = [
  [1440, 1000],
  [1024, 768],
] as const;
afterEach(async () => {
  cleanup();
  await page.viewport(initialViewport.width, initialViewport.height);
});
function setup() {
  let current = parseCadDocument(structuredClone(cupboard));
  const changes = vi.fn<(next: CadDocument) => void>();
  function Host() {
    const [document, setDocument] = useState(current);
    return (
      <div className="cad-editor" style={{ height: '100vh' }}>
        <FeatureList
          document={document}
          selectedPartId={null}
          onSelect={() => {}}
          onAction={() => {}}
          onRename={() => {}}
          onChange={next => {
            current = next;
            changes(next);
            setDocument(next);
          }}
        />
      </div>
    );
  }
  render(<Host />);
  return { changes, document: () => current };
}
async function settings() {
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Cupboard' }), { clientX: 20, clientY: 20 });
  await userEvent.click(screen.getByRole('menuitem', { name: 'Settings…' }));
  return screen.getByRole('dialog', { name: 'Cupboard' });
}
async function typeValue(dialog: HTMLElement, name: string, value: string) {
  const field = within(dialog).getByRole('textbox', { name: `Value of ${name}` });
  await userEvent.clear(field);
  await userEvent.type(field, value);
  expect(document.activeElement).toBe(field);
  return field;
}
const expression = (document: CadDocument, name: string) => document.variables!.find(variable => variable.name === name)!.expression;

it('shows the folder title, confirmation tick and compact variable rows at both reported sizes', async () => {
  setup();
  const dialog = await settings();
  for (const [width, height] of layoutSizes) {
    await page.viewport(width, height);
    const title = within(dialog).getByRole('heading', { name: 'Cupboard' }).getBoundingClientRect();
    const ok = within(dialog).getByRole('button', { name: 'OK' });
    const button = ok.getBoundingClientRect();
    const tick = ok.querySelector('svg')!.getBoundingClientRect();
    expect(title.width).toBeGreaterThan(40);
    expect(title.right).toBeLessThanOrEqual(button.left);
    expect(getComputedStyle(ok).backgroundColor).toBe('rgb(30, 142, 62)');
    expect(tick.width).toBeGreaterThan(10);
    expect(tick.left).toBeGreaterThanOrEqual(button.left);
    expect(tick.right).toBeLessThanOrEqual(button.right);
    const field = within(dialog).getByRole('textbox', { name: 'Value of width' });
    const row = field.closest('li')!;
    expect(getComputedStyle(row).display).toBe('grid');
    const boxes = [...row.children].map(child => child.getBoundingClientRect());
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i]!.left).toBeGreaterThanOrEqual(boxes[i - 1]!.right);
      expect(boxes[i]!.top).toBeLessThan(boxes[0]!.bottom);
    }
    expect(dialog.getBoundingClientRect().bottom).toBeLessThanOrEqual(height);
  }
});

it.each(['Cancel', 'Escape'])('discards a focused cupboard width edit with %s without publishing a document', async action => {
  const ui = setup();
  const before = structuredClone(ui.document());
  const dialog = await settings();
  await typeValue(dialog, 'width', '1000mm');
  if (action === 'Cancel') await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  else await userEvent.keyboard('{Escape}');
  expect(ui.document()).toEqual(before);
  expect(ui.changes).not.toHaveBeenCalled();
  if (action === 'Escape') expect(within(dialog).getByRole('textbox', { name: 'Value of width' })).toHaveValue('900mm');
  else expect(screen.queryByRole('dialog')).toBeNull();
});

it.each(['Cancel', 'Escape'])('keeps earlier blur-accepted settings while %s discards only the focused row', async action => {
  const ui = setup();
  const dialog = await settings();
  await typeValue(dialog, 'width', '1000mm');
  await userEvent.click(within(dialog).getByRole('textbox', { name: 'Value of height' }));
  expect(expression(ui.document(), 'width')).toBe('1000mm');
  const accepted = structuredClone(ui.document());
  const calls = ui.changes.mock.calls.length;
  await typeValue(dialog, 'height', '1100mm');
  if (action === 'Cancel') await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  else await userEvent.keyboard('{Escape}');
  expect(ui.document()).toEqual(accepted);
  expect(ui.changes).toHaveBeenCalledTimes(calls);
});

it.each(['Cancel', 'Escape'])('discards a pending variable rename with %s without rebinding cupboard expressions', async action => {
  const ui = setup();
  const before = structuredClone(ui.document());
  const dialog = await settings();
  const row = within(dialog).getByRole('textbox', { name: 'Value of width' }).closest('li')!;
  const name = within(row).getByRole('textbox', { name: 'Variable name' });
  await userEvent.clear(name);
  await userEvent.type(name, 'totalWidth');
  if (action === 'Cancel') await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  else await userEvent.keyboard('{Escape}');
  expect(ui.document()).toEqual(before);
  expect(ui.changes).not.toHaveBeenCalled();
});

it('accepts a focused pending value through the visible confirmation tick', async () => {
  const ui = setup();
  const dialog = await settings();
  await typeValue(dialog, 'width', '1050mm');
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  expect(expression(ui.document(), 'width')).toBe('1050mm');
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('retains the ordinary variable dialog cancellation behavior', async () => {
  const document = parseCadDocument(structuredClone(cupboard));
  const save = vi.fn(),
    cancel = vi.fn();
  render(
    <div className="cad-editor">
      <VariableDialog
        document={document}
        variableId={document.variables!.find(v => v.name === 'width')!.id}
        onSave={save}
        onCancel={cancel}
      />
    </div>
  );
  const dialog = screen.getByRole('dialog', { name: '#width' });
  const field = within(dialog).getByRole('textbox', { name: 'Value' });
  await userEvent.clear(field);
  await userEvent.type(field, '1200mm');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(cancel).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
  expect(expression(document, 'width')).toBe('900mm');
});
