import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DesignName, DesignSettings } from './DesignSettings';

afterEach(cleanup);
it('renames from the menu title, cancels Escape, ignores empty names and waits for IME confirmation', () => {
  const rename = vi.fn(() => true);
  render(<DesignName name="Untitled design" onRename={rename} />);
  const edit = () => fireEvent.click(screen.getByRole('button', { name: 'Rename design: Untitled design' }));
  edit();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Cabinet' } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', isComposing: true });
  expect(rename).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
  expect(rename).not.toHaveBeenCalled();
  edit();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '  ' } });
  fireEvent.blur(screen.getByRole('textbox'));
  expect(rename).not.toHaveBeenCalled();
  edit();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: ' Cabinet ' } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  expect(rename).toHaveBeenCalledExactlyOnceWith('Cabinet');
});

it('opens the saved unit and applies name and unit together', () => {
  const save = vi.fn(() => true);
  render(<DesignSettings value={{ name: 'Cabinet', lengthUnit: 'cm' }} onSave={save} />);
  fireEvent.click(screen.getByRole('button', { name: 'Design settings' }));
  expect((screen.getByRole('combobox', { name: 'Length unit' }) as HTMLSelectElement).value).toBe('cm');
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'in' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Design name' }), { target: { value: 'Cupboard' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Save settings' }).closest('form')!);
  expect(save).toHaveBeenCalledExactlyOnceWith({ name: 'Cupboard', lengthUnit: 'in' });
  expect(screen.queryByRole('dialog')).toBeNull();
});
