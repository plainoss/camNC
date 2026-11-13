import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createCadPart, createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { afterEach, expect, it, vi } from 'vitest';
import { BooleanDialog } from './BooleanDialog';

afterEach(cleanup);

function design(): CadDocument {
  const document = createPlateDocument({ width: 100, height: 40, thickness: 10 });
  document.parts[0]!.id = 'one';
  return { ...document, parts: [...document.parts, { ...createCadPart('Part 2', 30), id: 'two' }] };
}

it('opens on Union with nothing picked, joins the picked parts into the first, and accepts with Enter on Keep tools', async () => {
  const onSave = vi.fn();
  const view = (pick: { partId: string; seq: number } | null) => (
    <BooleanDialog document={design()} pick={pick} onSave={onSave} onClose={() => {}} />
  );
  const { rerender } = render(view(null));
  expect(screen.getAllByRole('tab').map(tab => [tab.textContent, tab.getAttribute('aria-selected')])).toEqual([
    ['Union', 'true'],
    ['Subtract', 'false'],
    ['Intersect', 'false'],
  ]);
  const tools = screen.getByRole('group', { name: 'Tools' });
  expect(within(tools).getByText('Click parts in the view or the parts list')).toBeDefined();
  rerender(view({ partId: 'one', seq: 1 }));
  rerender(view({ partId: 'two', seq: 2 }));
  await waitFor(() => expect(within(tools).getAllByRole('listitem')).toHaveLength(2));
  const keep = screen.getByRole('checkbox', { name: 'Keep tools' }) as HTMLInputElement;
  expect(keep.checked).toBe(false);
  fireEvent.keyDown(keep, { key: 'Enter' });
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({ operation: 'union', targets: ['one'], tools: ['two'], consumeTools: true }));
});

it('subtracts tools from targets, and says Intersect is not supported yet', async () => {
  const onSave = vi.fn();
  const view = (pick: { partId: string; seq: number } | null) => (
    <BooleanDialog document={design()} pick={pick} onSave={onSave} onClose={() => {}} />
  );
  const { rerender } = render(view(null));
  fireEvent.click(screen.getByRole('tab', { name: 'Intersect' }));
  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/at least two parts/));
  fireEvent.click(screen.getByRole('tab', { name: 'Subtract' }));
  fireEvent.click(screen.getByRole('group', { name: 'Targets' }));
  rerender(view({ partId: 'one', seq: 1 }));
  fireEvent.click(screen.getByRole('group', { name: 'Tools' }));
  rerender(view({ partId: 'two', seq: 2 }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Keep tools' }));
  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith({ operation: 'subtract', targets: ['one'], tools: ['two'], consumeTools: undefined })
  );
});
