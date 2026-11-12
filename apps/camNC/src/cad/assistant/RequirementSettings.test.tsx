import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { Requirements } from './RequirementSettings';

afterEach(cleanup);

it('keeps field and identity changes as a draft until explicitly confirmed', async () => {
  const onConfirm = vi.fn();
  const value = { width: 280 };
  const view = render(<Requirements value={value} onConfirm={onConfirm} />);
  expect(screen.getByRole('heading', { name: 'Confirmed requirements · active' })).toBeDefined();
  const confirm = screen.getByRole('button', { name: 'Confirm requirements' });
  expect(confirm).toBeDisabled();
  await userEvent.fill(screen.getByLabelText('Part outline width (mm)'), '300');
  await userEvent.fill(screen.getByLabelText(/Part name or ID/), 'Tray');
  await userEvent.click(screen.getByLabelText('Keep all existing entity IDs'));
  expect(onConfirm).not.toHaveBeenCalled();
  expect(value).toEqual({ width: 280 });
  expect(screen.getByText('Unconfirmed changes are not used by the assistant.')).toBeDefined();
  await userEvent.click(confirm);
  expect(onConfirm).toHaveBeenCalledExactlyOnceWith({ width: 300, part: 'Tray', preserveExistingIds: true });
  view.rerender(<Requirements value={{ width: 300, part: 'Tray', preserveExistingIds: true }} onConfirm={onConfirm} />);
  await waitFor(() => expect(confirm).toBeDisabled());
  expect(screen.queryByText('Unconfirmed changes are not used by the assistant.')).toBeNull();
});

it('clears only the draft until the user confirms removing requirements', async () => {
  const onConfirm = vi.fn();
  render(<Requirements value={{ width: 280, minimumFloor: 10, preserveExistingIds: true }} onConfirm={onConfirm} />);
  await userEvent.click(screen.getByRole('button', { name: 'Clear fields' }));
  expect(onConfirm).not.toHaveBeenCalled();
  expect((screen.getByLabelText('Part outline width (mm)') as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText('Keep all existing entity IDs') as HTMLInputElement).checked).toBe(false);
  expect(screen.getByRole('button', { name: 'Clear fields' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Confirm requirements' }));
  expect(onConfirm).toHaveBeenCalledExactlyOnceWith({});
});

it.each([
  ['Part outline width (mm)', '0'],
  ['Minimum pocket floor (mm)', '-1'],
  ['Assembly height (mm)', '1000001'],
  ['Through holes', '1.5'],
])('rejects invalid confirmed input for %s', async (label, invalid) => {
  const onConfirm = vi.fn();
  render(<Requirements value={{}} onConfirm={onConfirm} />);
  await userEvent.fill(screen.getByLabelText(label), invalid);
  await userEvent.click(screen.getByRole('button', { name: 'Confirm requirements' }));
  expect(onConfirm).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toMatch(/positive finite|non-negative integers/);
  await userEvent.click(screen.getByRole('button', { name: 'Clear fields' }));
  expect(screen.queryByRole('alert')).toBeNull();
});

it('disables every input and action while busy without discarding the pending draft', async () => {
  const onConfirm = vi.fn();
  const value = { width: 280 };
  const view = render(<Requirements value={value} onConfirm={onConfirm} />);
  const width = screen.getByLabelText('Part outline width (mm)') as HTMLInputElement;
  await userEvent.fill(width, '300');
  view.rerender(<Requirements value={value} disabled onConfirm={onConfirm} />);
  for (const field of view.container.querySelectorAll('input,button')) expect(field).toBeDisabled();
  // Native clicks respect disabled fieldsets, including when only the ancestor is disabled.
  (screen.getByRole('button', { name: 'Confirm requirements' }) as HTMLButtonElement).click();
  (screen.getByRole('button', { name: 'Clear fields' }) as HTMLButtonElement).click();
  expect(onConfirm).not.toHaveBeenCalled();
  expect(width.value).toBe('300');
  view.rerender(<Requirements value={value} onConfirm={onConfirm} />);
  await userEvent.click(screen.getByRole('button', { name: 'Confirm requirements' }));
  expect(onConfirm).toHaveBeenCalledExactlyOnceWith({ width: 300 });
});

it('uses newly confirmed parent state when the selected design or requirements change', async () => {
  const onConfirm = vi.fn();
  const view = render(<Requirements value={{ width: 280 }} onConfirm={onConfirm} />);
  const width = screen.getByLabelText('Part outline width (mm)') as HTMLInputElement;
  await userEvent.fill(width, '300');
  view.rerender(<Requirements value={{ width: 400, minimumFloor: 12 }} onConfirm={onConfirm} />);
  await waitFor(() => expect(width.value).toBe('400'));
  expect((screen.getByLabelText('Minimum pocket floor (mm)') as HTMLInputElement).value).toBe('12');
  expect(screen.getByRole('button', { name: 'Confirm requirements' })).toBeDisabled();
  expect(onConfirm).not.toHaveBeenCalled();
});
