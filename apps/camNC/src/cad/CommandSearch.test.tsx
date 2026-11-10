import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CommandSearch } from './CommandSearch';
import { kStudioCommands } from './studioCommands';
import './cad.css';

afterEach(cleanup);

it.each(kStudioCommands)('keeps the $label search icon compact and outlined', command => {
  render(<CommandSearch commands={[command]} onChoose={vi.fn()} onClose={vi.fn()} onHighlight={vi.fn()} />);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: command.label } });
  const option = screen.getByRole('option', { name: command.label });
  const icon = option.querySelector('svg')!;
  expect(icon.getBoundingClientRect().width).toBe(20);
  expect(icon.getBoundingClientRect().height).toBe(20);
  expect(option.getBoundingClientRect().height).toBeLessThan(50);
  expect(getComputedStyle(icon).fill).toBe('none');
  expect(getComputedStyle(icon).stroke).toBe(getComputedStyle(option).color);
});
