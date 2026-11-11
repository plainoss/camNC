import type { ProviderConfig } from './provider';

/** Deliberately independent of settings, demoStorage, account sync and exported backups. */
export const ASSISTANT_KEY_STORAGE = 'camnc.assistant.credentials.v1';
export interface AssistantCredentials {
  config: ProviderConfig;
  key: string;
}
let sessionCredentials: AssistantCredentials | null | undefined;
export const defaultProvider: ProviderConfig = {
  kind: 'anthropic',
  endpoint: 'https://api.anthropic.com/v1',
  model: '',
  protocol: 'chat',
  tools: true,
  images: false,
};

export function readAssistantCredentials(storage: Pick<Storage, 'getItem' | 'removeItem'> = localStorage): AssistantCredentials | null {
  if (typeof localStorage !== 'undefined' && storage === localStorage && sessionCredentials !== undefined) return sessionCredentials;
  try {
    const value = JSON.parse(storage.getItem(ASSISTANT_KEY_STORAGE) ?? 'null') as AssistantCredentials | null;
    if (
      value &&
      typeof value.key === 'string' &&
      value.config &&
      ['anthropic', 'compatible'].includes(value.config.kind) &&
      typeof value.config.endpoint === 'string' &&
      typeof value.config.model === 'string' &&
      ['chat', 'responses'].includes(value.config.protocol) &&
      typeof value.config.tools === 'boolean' &&
      typeof value.config.images === 'boolean' &&
      (value.config.promptCaching === undefined || typeof value.config.promptCaching === 'boolean') &&
      (value.config.imageModel === undefined || typeof value.config.imageModel === 'string')
    )
      return value;
  } catch {
    /* A corrupt or inaccessible local store must not prevent opening the design. */
  }
  return null;
}

export function rememberAssistantCredentials(
  value: AssistantCredentials | null,
  storage: Pick<Storage, 'setItem' | 'removeItem'> = localStorage
) {
  if (typeof localStorage !== 'undefined' && storage === localStorage) sessionCredentials = value;
  if (value) storage.setItem(ASSISTANT_KEY_STORAGE, JSON.stringify(value));
  else storage.removeItem(ASSISTANT_KEY_STORAGE);
}

/** Session-only keys survive closing the dock, but never survive reloading the application. */
export function setAssistantCredentials(value: AssistantCredentials, remember: boolean) {
  rememberAssistantCredentials(remember ? value : null);
  sessionCredentials = value;
}

export function redactAssistantText(text: string, key: string): string {
  return key ? text.split(key).join('[key removed]') : text;
}
