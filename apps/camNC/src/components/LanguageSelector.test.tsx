import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageSelector } from './LanguageSelector';

const state = vi.hoisted(() => ({ api: null as null | { isConnected: { value: boolean }; status: { value: null | { state: string } } } }));
const save = vi.hoisted(() => vi.fn(() => false));
vi.mock('@/lib/fluidnc/machineInstance', () => ({ getExistingCncApi: () => state.api }));
vi.mock('@wbcnc/i18n', async importOriginal => ({
  ...(await importOriginal<typeof import('@wbcnc/i18n')>()),
  getLanguage: () => 'en',
  saveLanguage: save,
}));
afterEach(() => {
  cleanup();
  state.api = null;
  save.mockClear();
});

function chooseFrench() {
  render(<LanguageSelector />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: 'fr' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply and reload' }));
}

describe('language changes', () => {
  it.each(['Run', 'Hold', 'Door', 'Jog', 'Alarm', undefined])('does not persist or reload during connected state %s', status => {
    state.api = { isConnected: { value: true }, status: { value: status ? { state: status } : null } };
    chooseFrench();
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('idle or disconnected');
  });
  it('reports storage failure instead of reloading and losing the selected language', () => {
    state.api = { isConnected: { value: true }, status: { value: { state: 'Idle' } } };
    chooseFrench();
    expect(save).toHaveBeenCalledWith('fr');
    expect(screen.getByRole('alert').textContent).toContain('could not be saved');
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('fr');
  });
  it('asks for an explicit reload and explains that work must be saved', () => {
    render(<LanguageSelector />);
    expect(screen.queryByRole('button')).toBeNull();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'fr' } });
    expect(screen.getByText('Save your work before reloading to apply the language.')).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });
});
