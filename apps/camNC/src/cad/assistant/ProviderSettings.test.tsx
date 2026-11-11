import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { ProviderSettings } from './ProviderSettings';
import type { ProviderConfig } from './provider';
import { ASSISTANT_KEY_STORAGE, readAssistantCredentials, rememberAssistantCredentials } from './keyStore';

afterEach(() => {
  cleanup();
  rememberAssistantCredentials(null);
});

it('connects with only a key: the preset fills the model and the test confirms capabilities', async () => {
  const onSave = vi.fn();
  const test = vi.fn(async (config: ProviderConfig) => ({
    config: { ...config, images: false },
    notes: ['This model does not accept images; reference pictures and view checks are off.'],
  }));
  render(<ProviderSettings value={null} onSave={onSave} test={test} />);
  expect(screen.getByRole('radio', { name: 'Anthropic' })).toHaveProperty('ariaChecked', 'true');
  expect(screen.getByLabelText('Model')).toHaveProperty('value', 'claude-sonnet-5-5');
  await userEvent.type(screen.getByLabelText('API key'), 'sk-ant-test');
  await userEvent.click(screen.getByRole('button', { name: 'Test and connect' }));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(test.mock.calls[0]![0]).toMatchObject({ kind: 'anthropic', endpoint: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5' });
  expect(onSave.mock.calls[0]![0]).toMatchObject({ key: 'sk-ant-test', config: { images: false, tools: true } });
  // Remembered by default so a reload does not ask again.
  expect(localStorage.getItem(ASSISTANT_KEY_STORAGE)).toContain('claude-sonnet-5-5');
});

it('keeps a failed test from saving and explains why', async () => {
  const onSave = vi.fn();
  const test = vi.fn(async () => {
    throw new Error('The provider rejected this key, or the key cannot use this model.');
  });
  render(<ProviderSettings value={null} onSave={onSave} test={test} />);
  await userEvent.type(screen.getByLabelText('API key'), 'wrong');
  await userEvent.click(screen.getByRole('button', { name: 'Test and connect' }));
  expect((await screen.findByRole('alert')).textContent).toContain('rejected this key');
  expect(onSave).not.toHaveBeenCalled();
  expect(readAssistantCredentials()).toBeNull();
});

it('offers the full form for other providers and a model ID field', async () => {
  render(<ProviderSettings value={null} onSave={() => {}} test={vi.fn()} />);
  await userEvent.click(screen.getByRole('radio', { name: 'Other…' }));
  expect(screen.getByLabelText('API address')).toBeDefined();
  expect(screen.getByLabelText('Model ID')).toHaveProperty('value', '');
  await userEvent.click(screen.getByRole('radio', { name: 'Anthropic' }));
  await userEvent.selectOptions(screen.getByLabelText('Model'), '');
  expect(screen.getByLabelText('Model ID')).toBeDefined();
});
