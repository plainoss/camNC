import { useEffect, useRef, useState } from 'react';
import { rememberAssistantCredentials, setAssistantCredentials, type AssistantCredentials } from './keyStore';
import { providerUrl, type ProviderConfig } from './provider';
import { connectionPreset, connectionPresets, type ConnectionPresetId } from './connectionPresets';
import { testAssistantConnection } from './connectionTest';
import { detectKeyProvider } from './modelDefaults';

/**
 * Key only: the key's prefix picks the provider, the provider's model list picks the text and image models, and a test
 * request confirms them before saving. Models, address and capabilities stay available as optional overrides.
 */
export function ProviderSettings({
  value,
  onSave,
  test = testAssistantConnection,
}: {
  value: AssistantCredentials | null;
  onSave: (value: AssistantCredentials | null) => void;
  test?: typeof testAssistantConnection;
}) {
  const initial = connectionPreset(value?.config);
  const [presetId, setPresetId] = useState<ConnectionPresetId>(initial.id);
  const preset = connectionPresets.find(item => item.id === presetId)!;
  // A blank model means automatic: the connection test chooses from the provider's own list.
  const [config, setConfig] = useState<ProviderConfig>(value?.config ?? { ...initial.config, model: '' });
  const picked = useRef(!!value);
  const [key, setKey] = useState(value?.key ?? '');
  // Reloading should not ask for the key again; unticking keeps it for this app session only.
  const [remember, setRemember] = useState(true);
  const [advanced, setAdvanced] = useState(presetId === 'other');
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const listed = !config.model || preset.models.some(model => model.id === config.model);
  const [customModel, setCustomModel] = useState(!listed);
  const choosePreset = (id: ConnectionPresetId) => {
    const next = connectionPresets.find(item => item.id === id)!;
    setPresetId(id);
    setConfig({ ...next.config, model: '' });
    setCustomModel(false);
    setAdvanced(id === 'other');
    setError('');
    setNotes([]);
  };
  const validate = (requireModel: boolean) => {
    providerUrl(config);
    if (!key.trim()) throw new Error('Enter your API key.');
    if (requireModel && !config.model.trim() && !preset.models[0]) throw new Error('Enter the model ID from your provider.');
    if (!config.tools) throw new Error('The assistants need a model that supports tools.');
    const model = config.model.trim() || (requireModel ? preset.models[0]!.id : '');
    const imageModel = config.imageModel?.trim();
    const { imageModel: _image, ...rest } = config;
    return { key: key.trim(), config: { ...rest, model, ...(imageModel && { imageModel }) } };
  };
  const save = (next: AssistantCredentials) => {
    setAssistantCredentials(next, remember);
    onSave(next);
  };
  return (
    <form
      className="cad-assistant-settings"
      aria-busy={testing}
      onSubmit={event => {
        event.preventDefault();
        if (testing) return;
        let next: AssistantCredentials;
        try {
          next = validate(false);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Unable to save this connection.');
          return;
        }
        const abort = new AbortController();
        controller.current = abort;
        setTesting(true);
        setError('');
        setNotes([]);
        void test(next.config, next.key, abort.signal)
          .then(result => {
            if (abort.signal.aborted) return;
            setConfig(result.config);
            setNotes(result.notes);
            save({ ...next, config: result.config });
          })
          .catch(cause => {
            if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'The connection test failed.');
          })
          .finally(() => {
            if (controller.current === abort) setTesting(false);
          });
      }}>
      <div className="cad-assistant-connection-intro">
        <span className="cad-assistant-eyebrow">ONE CONNECTION FOR EVERY ASSISTANT</span>
        <h3>Connect an AI provider</h3>
        <p>Paste your key. The provider, models, address and capabilities are chosen and checked for you.</p>
      </div>
      <label>
        API key
        <input
          type="password"
          autoComplete="off"
          placeholder={preset.keyPlaceholder}
          value={key}
          disabled={testing}
          onChange={event => {
            setKey(event.target.value);
            // Until a provider is picked by hand, the key's prefix chooses it.
            const detected = detectKeyProvider(event.target.value);
            if (!picked.current && detected && detected !== presetId) choosePreset(detected);
          }}
        />
      </label>
      <div className="cad-assistant-presets" role="radiogroup" aria-label="Provider">
        {connectionPresets.map(item => (
          <button
            type="button"
            role="radio"
            key={item.id}
            aria-checked={presetId === item.id}
            disabled={testing}
            onClick={() => {
              picked.current = true;
              choosePreset(item.id);
            }}>
            {item.label}
          </button>
        ))}
      </div>
      <details className="cad-assistant-advanced">
        <summary>Models (optional)</summary>
        <fieldset disabled={testing}>
          <label>
            Design model
            <select
              value={customModel ? 'custom' : config.model}
              onChange={event => {
                const custom = event.target.value === 'custom';
                setCustomModel(custom);
                if (!custom) setConfig({ ...config, model: event.target.value });
              }}>
              <option value="">Automatic (recommended)</option>
              {preset.models.map(model => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
              <option value="custom">Another model ID…</option>
            </select>
          </label>
          {customModel && (
            <label>
              Model ID
              <input value={config.model} placeholder="Model ID" onChange={event => setConfig({ ...config, model: event.target.value })} />
            </label>
          )}
          {config.kind !== 'anthropic' && (
            <label>
              Image model, for Carve
              <input
                value={config.imageModel ?? ''}
                placeholder="Automatic"
                onChange={event => setConfig({ ...config, imageModel: event.target.value || undefined })}
              />
            </label>
          )}
        </fieldset>
      </details>
      <label className="cad-assistant-check">
        <input type="checkbox" checked={remember} disabled={testing} onChange={event => setRemember(event.target.checked)} />
        Remember on this device
      </label>
      <details className="cad-assistant-advanced" open={advanced} onToggle={event => setAdvanced(event.currentTarget.open)}>
        <summary>Address and capabilities</summary>
        <fieldset disabled={testing}>
          <label>
            API address
            <input type="url" value={config.endpoint} onChange={event => setConfig({ ...config, endpoint: event.target.value })} />
          </label>
          <label>
            API type
            <select
              value={config.kind === 'anthropic' ? 'anthropic' : config.protocol}
              onChange={event =>
                setConfig(
                  event.target.value === 'anthropic'
                    ? { ...config, kind: 'anthropic', protocol: 'chat' }
                    : { ...config, kind: 'compatible', protocol: event.target.value as 'chat' | 'responses' }
                )
              }>
              <option value="anthropic">Anthropic Messages</option>
              <option value="responses">OpenAI Responses</option>
              <option value="chat">OpenAI Chat Completions</option>
            </select>
          </label>
          <label className="cad-assistant-check">
            <input type="checkbox" checked={config.images} onChange={event => setConfig({ ...config, images: event.target.checked })} />
            Try image input (the test turns it off if the model refuses images)
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
          <button
            type="button"
            onClick={() => {
              try {
                save(validate(true));
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : 'Unable to save this connection.');
              }
            }}>
            Save without testing
          </button>
        </fieldset>
      </details>
      <p>
        Your key and requests go straight from this browser to the provider. The key stays out of account sync and settings backups. The
        test sends one tiny request (well under a cent) and no design data.
      </p>
      {testing && <p role="status">Testing the connection…</p>}
      {notes.map(note => (
        <p key={note} role="status">
          {note}
        </p>
      ))}
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={testing}>
        {testing ? 'Testing…' : 'Test and connect'}
      </button>
      {testing && (
        <button type="button" onClick={() => controller.current?.abort()}>
          Cancel
        </button>
      )}
      {value && !testing && (
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
