import type { ProviderConfig } from './provider';

export type ConnectionPresetId = 'anthropic' | 'openai' | 'gemini' | 'other';
export interface ConnectionPreset {
  id: ConnectionPresetId;
  label: string;
  config: Omit<ProviderConfig, 'model'>;
  /** Listed models; the first is the recommended default. Empty means the model ID is typed. */
  models: { id: string; label: string }[];
  keyPlaceholder: string;
}

/** Capabilities here are starting values; the connection test confirms tools and images before saving. */
export const connectionPresets: ConnectionPreset[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    config: { kind: 'anthropic', endpoint: 'https://api.anthropic.com/v1', protocol: 'chat', tools: true, images: true },
    models: [
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (recommended)' },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (most capable, slower)' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest, cheapest)' },
    ],
    keyPlaceholder: 'sk-ant-…',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    config: { kind: 'compatible', endpoint: 'https://api.openai.com/v1', protocol: 'responses', tools: true, images: true },
    models: [],
    keyPlaceholder: 'sk-…',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    // Gemini's OpenAI-compatible API: chat completions with tools and image input, plus image generation for Carve.
    config: {
      kind: 'compatible',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
      protocol: 'chat',
      tools: true,
      images: true,
    },
    models: [],
    keyPlaceholder: 'AIza…',
  },
  {
    id: 'other',
    label: 'Other…',
    config: { kind: 'compatible', endpoint: 'https://', protocol: 'chat', tools: true, images: false },
    models: [],
    keyPlaceholder: 'API key',
  },
];

export function connectionPreset(config: ProviderConfig | undefined): ConnectionPreset {
  if (!config) return connectionPresets[0]!;
  const other = connectionPresets.find(preset => preset.id === 'other')!;
  return (
    connectionPresets.find(
      preset => preset.id !== 'other' && preset.config.kind === config.kind && preset.config.endpoint === config.endpoint.replace(/\/$/, '')
    ) ?? other
  );
}

/** A short name for headers and summaries; never includes the key. */
export function connectionLabel(config: ProviderConfig): string {
  const preset = connectionPreset(config);
  const model = preset.models.find(model => model.id === config.model)?.label.replace(/ \(.*\)$/, '') ?? config.model;
  return preset.id === 'other' ? `${model} · ${new URL(config.endpoint).host}` : model;
}
