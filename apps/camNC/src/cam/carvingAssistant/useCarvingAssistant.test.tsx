import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { defaultProvider, rememberAssistantCredentials, type AssistantCredentials } from '../../cad/assistant/keyStore';
import { createCarvingJob, type CamJobV1 } from '../jobDb';
import { useCarvingAssistant } from './useCarvingAssistant';

const anthropic: AssistantCredentials = { config: { ...defaultProvider, model: 'recorded' }, key: 'recorded-key' };
const openai: AssistantCredentials = {
  key: 'sk-openai-test',
  config: {
    kind: 'compatible',
    protocol: 'responses',
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-x',
    imageModel: 'gpt-image-x',
    tools: true,
    images: true,
  },
};

beforeEach(() => rememberAssistantCredentials(anthropic));
afterEach(() => {
  cleanup();
  rememberAssistantCredentials(null);
});

function setup(job: CamJobV1, selectedId: string | null = null) {
  return renderHook(() => useCarvingAssistant({ job, selectedId, onApply: () => {} }));
}

it('lets a key with its own image model take over from a half-filled image provider', async () => {
  const { result } = setup(await createCarvingJob(undefined, { lettering: 'Welcome' }));
  act(() => result.current.connection.setNative({ ...result.current.connection.native, key: 'half-typed' }));
  act(() => result.current.connection.setCredentials(openai));
  expect(result.current.connection.separateImage).toBe(false);
  act(() => result.current.request.setPrompt('An owl'));
  expect(result.current.request.canGenerate).toBe(true);
});

it('keeps a complete image provider entered before connecting a key with its own image model', async () => {
  const { result } = setup(await createCarvingJob(undefined, { lettering: 'Welcome' }));
  act(() => result.current.connection.setNative({ ...result.current.connection.native, key: 'separate', model: 'img', supportsSvg: true }));
  act(() => result.current.connection.setCredentials(openai));
  expect(result.current.connection.separateImage).toBe(true);
});

it('switches reopened artwork from Text SVG to images once a key with an image model is connected', async () => {
  const job = await createCarvingJob(undefined, { lettering: 'Welcome' });
  const item = job.carving!.items[0];
  item.generated = {
    assetId: 'a',
    sourceSvg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    prompt: 'An owl',
    summary: 'An owl',
    detail: 'simple',
    width: 40,
    height: 30,
    checkedFor: 'old-settings',
  };
  const { result } = setup(job, item.id);
  act(() => result.current.setOpen(true));
  expect(result.current.connection.generationMode).toBe('text');
  act(() => result.current.connection.setCredentials(openai));
  expect(result.current.connection.generationMode).toBe('native');
});

it('keeps a method the person chose when a key with an image model is connected', async () => {
  const { result } = setup(await createCarvingJob(undefined, { lettering: 'Welcome' }));
  act(() => result.current.connection.setGenerationMode('text'));
  act(() => result.current.connection.setCredentials(openai));
  expect(result.current.connection.generationMode).toBe('text');
});
