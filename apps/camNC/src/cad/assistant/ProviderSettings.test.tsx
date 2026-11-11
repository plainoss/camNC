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
  expect(screen.getByLabelText('Design model')).toHaveProperty('value', '');
  await userEvent.type(screen.getByLabelText('API key'), 'sk-ant-test');
  expect(screen.getByRole('radio', { name: 'Anthropic' })).toHaveProperty('ariaChecked', 'true');
  await userEvent.click(screen.getByRole('button', { name: 'Test and connect' }));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  // Blank means automatic: the test picks the model from the provider's list.
  expect(test.mock.calls[0]![0]).toMatchObject({ kind: 'anthropic', endpoint: 'https://api.anthropic.com/v1', model: '' });
  expect(onSave.mock.calls[0]![0]).toMatchObject({ key: 'sk-ant-test', config: { images: false, tools: true } });
  // Remembered by default so a reload does not ask again.
  expect(localStorage.getItem(ASSISTANT_KEY_STORAGE)).toContain('sk-ant-test');
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
  // Other endpoints choose from their own model list too, unless a model ID is entered.
  expect(screen.getByLabelText('Design model')).toHaveProperty('value', '');
  await userEvent.click(screen.getByRole('radio', { name: 'Anthropic' }));
  await userEvent.click(screen.getByText('Models (optional)'));
  await userEvent.selectOptions(screen.getByLabelText('Design model'), 'custom');
  expect(screen.getByLabelText('Model ID')).toBeDefined();
});

it('picks the provider from the key and offers an image model override for OpenAI', async () => {
  const test = vi.fn(async (config: ProviderConfig) => ({ config: { ...config, model: 'gpt-x', imageModel: 'gpt-image-x' }, notes: [] }));
  const onSave = vi.fn();
  render(<ProviderSettings value={null} onSave={onSave} test={test} />);
  await userEvent.type(screen.getByLabelText('API key'), 'sk-proj-123');
  expect(screen.getByRole('radio', { name: 'OpenAI' })).toHaveProperty('ariaChecked', 'true');
  expect(screen.getByLabelText('Image model, for Carve')).toBeDefined();
  await userEvent.click(screen.getByRole('button', { name: 'Test and connect' }));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(test.mock.calls[0]![0]).toMatchObject({ kind: 'compatible', endpoint: 'https://api.openai.com/v1', model: '' });
  expect(test.mock.calls[0]![0].imageModel).toBeUndefined();
  expect(onSave.mock.calls[0]![0].config).toMatchObject({ model: 'gpt-x', imageModel: 'gpt-image-x' });
});
