import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LetteringFontPicker } from './LetteringFontPicker';

vi.mock('./webFonts', async importOriginal => ({
  ...(await importOriginal<typeof import('./webFonts')>()),
  fontsOnDevice: async () => [{ family: 'Roboto', weight: 700 }],
  previewStylesheetUrl: (family: string) => `data:text/css,/*${encodeURIComponent(family)}*/`,
}));
afterEach(cleanup);

it('searches the catalog and selects the family’s default weight', async () => {
  const onChange = vi.fn();
  render(
    <>
      <label htmlFor="carve-font">Font</label>
      <LetteringFontPicker font="sans" onChange={onChange} />
    </>
  );
  fireEvent.click(screen.getByRole('combobox', { name: 'Font' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Search fonts' }), { target: { value: 'LoB' } });
  const lobster = await screen.findByRole('option', { name: 'Lobster' });
  // Built-ins that don't match are hidden, so Enter picks the best match.
  expect(screen.queryByRole('option', { name: 'Sans, bold' })).toBeNull();
  fireEvent.click(lobster);
  expect(onChange).toHaveBeenCalledWith({ family: 'Lobster', weight: 400 });
  await waitFor(() => expect(screen.queryByRole('option', { name: 'Lobster' })).toBeNull());
});

it('filters by category and caps results, built-ins included', async () => {
  render(<LetteringFontPicker font="sans" onChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('combobox', { name: 'Font' }));
  await screen.findByRole('option', { name: 'Open Sans' });
  for (const name of ['Sans, bold', 'Serif, bold', 'Slab']) expect(screen.getByRole('option', { name })).toBeTruthy();
  expect(screen.getAllByRole('option').length).toBeLessThanOrEqual(83);
  expect(screen.getByText('On this device')).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox', { name: 'Search fonts' }), { target: { value: 'lobster' } });
  await screen.findByRole('option', { name: 'Lobster' });
  fireEvent.click(screen.getByRole('button', { name: 'Mono' }));
  expect(screen.queryByRole('option', { name: 'Lobster' })).toBeNull();
  fireEvent.change(screen.getByRole('combobox', { name: 'Search fonts' }), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Serif' }));
  expect(screen.getByRole('option', { name: 'Slab' })).toBeTruthy();
  expect(screen.queryByRole('option', { name: 'Sans, bold' })).toBeNull();
  fireEvent.change(screen.getByRole('combobox', { name: 'Search fonts' }), { target: { value: 'lobster' } });
  fireEvent.click(screen.getByRole('button', { name: 'Display' }));
  expect(await screen.findByRole('option', { name: 'Lobster' })).toBeTruthy();
});

it('offers the chosen family’s weights and preserves its family when weight changes', async () => {
  const onChange = vi.fn();
  render(<LetteringFontPicker font={{ family: 'Roboto', weight: 700 }} onChange={onChange} />);
  const weight = await screen.findByRole('combobox', { name: 'Font weight' });
  fireEvent.change(weight, { target: { value: '900' } });
  expect(onChange).toHaveBeenCalledWith({ family: 'Roboto', weight: 900 });
});
