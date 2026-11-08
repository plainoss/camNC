import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LetteringFontPicker } from './LetteringFontPicker';

vi.mock('./webFonts', async importOriginal => ({
  ...(await importOriginal<typeof import('./webFonts')>()),
  fontsOnDevice: async () => [{ family: 'Roboto', weight: 700 }],
  previewStylesheetUrl: (family: string) => `data:text/css,/*${encodeURIComponent(family)}*/`,
}));
afterEach(cleanup);

it('searches the catalog and selects the family’s default weight, with built-ins always available', async () => {
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
  for (const name of ['Sans, bold', 'Serif, bold', 'Slab']) expect(screen.getByRole('option', { name })).toBeTruthy();
  fireEvent.click(lobster);
  expect(onChange).toHaveBeenCalledWith({ family: 'Lobster', weight: 400 });
  await waitFor(() => expect(screen.queryByRole('option', { name: 'Lobster' })).toBeNull());
});

it('filters by category, caps results, and keeps built-ins under every filter', async () => {
  render(<LetteringFontPicker font="sans" onChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('combobox', { name: 'Font' }));
  await screen.findByRole('option', { name: 'Open Sans' });
  expect(screen.getAllByRole('option').length).toBeLessThanOrEqual(83);
  expect(screen.getByText('On this device')).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox', { name: 'Search fonts' }), { target: { value: 'lobster' } });
  await screen.findByRole('option', { name: 'Lobster' });
  fireEvent.click(screen.getByRole('button', { name: 'Mono' }));
  expect(screen.queryByRole('option', { name: 'Lobster' })).toBeNull();
  expect(screen.getByRole('option', { name: 'Sans, bold' })).toBeTruthy();
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
