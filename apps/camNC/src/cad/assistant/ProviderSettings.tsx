import { useState } from 'react';
import { defaultProvider, rememberAssistantCredentials, setAssistantCredentials, type AssistantCredentials } from './keyStore';
import { providerUrl } from './provider';

export function ProviderSettings({
  value,
  onSave,
}: {
  value: AssistantCredentials | null;
  onSave: (value: AssistantCredentials | null) => void;
}) {
  const [config, setConfig] = useState(value?.config ?? defaultProvider);
  const [key, setKey] = useState(value?.key ?? '');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      className="cad-assistant-settings"
      onSubmit={event => {
        event.preventDefault();
        try {
          providerUrl(config);
          if (!key.trim() || !config.model.trim() || !config.tools)
            throw new Error('Enter your key and model ID, and confirm tool support.');
          const next = { key: key.trim(), config: { ...config, model: config.model.trim() } };
          setAssistantCredentials(next, remember);
          onSave(next);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Unable to save this connection.');
        }
      }}>
      <div className="cad-assistant-connection-intro">
        <span className="cad-assistant-eyebrow">YOUR DESIGN PARTNER</span>
        <h3>Connect your assistant</h3>
        <p>Choose a provider and bring your own key to start designing.</p>
      </div>
      <label>
        Provider
        <select
          value={config.kind}
          onChange={event =>
            setConfig({
              ...config,
              kind: event.target.value as 'anthropic' | 'compatible',
              endpoint: event.target.value === 'anthropic' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1',
              protocol: event.target.value === 'compatible' ? 'responses' : 'chat',
            })
          }>
          <option value="anthropic">Anthropic</option>
          <option value="compatible">OpenAI compatible</option>
        </select>
      </label>
      <label>
        API address
        <input type="url" required value={config.endpoint} onChange={event => setConfig({ ...config, endpoint: event.target.value })} />
      </label>
      {config.kind === 'compatible' && (
        <label>
          API protocol
          <select
            value={config.protocol}
            onChange={event => setConfig({ ...config, protocol: event.target.value as 'chat' | 'responses' })}>
            <option value="responses">Responses</option>
            <option value="chat">Chat Completions</option>
          </select>
        </label>
      )}
      <label>
        Model ID
        <input required value={config.model} onChange={event => setConfig({ ...config, model: event.target.value })} />
      </label>
      <label>
        API key
        <input type="password" autoComplete="off" required value={key} onChange={event => setKey(event.target.value)} />
      </label>
      <label className="cad-assistant-check">
        <input type="checkbox" checked={config.tools} onChange={event => setConfig({ ...config, tools: event.target.checked })} />
        This model supports tools
      </label>
      <label className="cad-assistant-check">
        <input type="checkbox" checked={config.images} onChange={event => setConfig({ ...config, images: event.target.checked })} />
        This model reads images
      </label>
      {config.kind === 'anthropic' && (
        <label className="cad-assistant-check">
          <input
            type="checkbox"
            checked={config.promptCaching !== false}
            onChange={event => setConfig({ ...config, promptCaching: event.target.checked })}
          />
          Reuse prompt context with Anthropic caching (cache writes are billed)
        </label>
      )}
      <label className="cad-assistant-check">
        <input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} />
        Remember key on this device
      </label>
      <p>Your key and design go directly to this provider. The key stays out of account sync and settings backups.</p>
      {error && <p role="alert">{error}</p>}
      <button type="submit">Use connection</button>
      {value && (
        <button
          type="button"
          onClick={() => {
            rememberAssistantCredentials(null);
            setKey('');
            onSave(null);
          }}>
          Forget key
        </button>
      )}
    </form>
  );
}
