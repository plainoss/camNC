import { useEffect, useRef, useState } from 'react';
import { rememberAssistantCredentials, setAssistantCredentials, type AssistantCredentials } from './keyStore';
import { providerUrl, type ProviderConfig } from './provider';
import { connectionPreset, connectionPresets, type ConnectionPresetId } from './connectionPresets';
import { testAssistantConnection } from './connectionTest';

/** Key first: a preset fills the address, protocol and capabilities, and a test request confirms them before saving. */
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
  const [config, setConfig] = useState<ProviderConfig>(value?.config ?? { ...initial.config, model: initial.models[0]?.id ?? '' });
  const [key, setKey] = useState(value?.key ?? '');
  // Reloading should not ask for the key again; unticking keeps it for this app session only.
  const [remember, setRemember] = useState(true);
  const [advanced, setAdvanced] = useState(presetId === 'other');
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const listed = preset.models.some(model => model.id === config.model);
  const choosePreset = (id: ConnectionPresetId) => {
    const next = connectionPresets.find(item => item.id === id)!;
    setPresetId(id);
    setConfig({ ...next.config, model: next.models[0]?.id ?? '' });
    setAdvanced(id === 'other');
    setError('');
    setNotes([]);
  };
  const validate = () => {
    providerUrl(config);
    if (!key.trim()) throw new Error('Enter your API key.');
    if (!config.model.trim()) throw new Error('Enter the model ID from your provider.');
    if (!config.tools) throw new Error('The assistants need a model that supports tools.');
    return { key: key.trim(), config: { ...config, model: config.model.trim() } };
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
          next = validate();
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
        <p>Paste your key. Address, tool and image support are filled in and checked for you.</p>
      </div>
      <div className="cad-assistant-presets" role="radiogroup" aria-label="Provider">
        {connectionPresets.map(item => (
          <button
            type="button"
            role="radio"
            key={item.id}
            aria-checked={presetId === item.id}
            disabled={testing}
            onClick={() => choosePreset(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      <label>
        API key
        <input
          type="password"
          autoComplete="off"
          placeholder={preset.keyPlaceholder}
          value={key}
          disabled={testing}
          onChange={event => setKey(event.target.value)}
        />
      </label>
      {preset.models.length ? (
        <label>
          Model
          <select
            value={listed ? config.model : ''}
            disabled={testing}
            onChange={event => setConfig({ ...config, model: event.target.value })}>
            {preset.models.map(model => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
            <option value="">Another model ID…</option>
          </select>
        </label>
      ) : null}
      {(!preset.models.length || !listed) && (
        <label>
          Model ID
          <input
            value={config.model}
            disabled={testing}
            placeholder={preset.id === 'openai' ? 'The model ID from your OpenAI project' : 'Model ID'}
            onChange={event => setConfig({ ...config, model: event.target.value })}
          />
        </label>
      )}
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
                save(validate());
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
