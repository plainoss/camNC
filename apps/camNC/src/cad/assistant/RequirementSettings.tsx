import { useEffect, useState } from 'react';
import { requirementLengths, validateAssistantRequirements, type AssistantRequirements } from './requirements';

const labels: Record<string, string> = {
  width: 'Part outline width',
  height: 'Part outline height',
  thickness: 'Part thickness',
  pocketDepth: 'Every blind cut depth',
  minimumFloor: 'Minimum pocket floor',
  minimumWall: 'Minimum outer top-pocket wall',
  assemblyWidth: 'Assembly width',
  assemblyDepth: 'Assembly depth',
  assemblyHeight: 'Assembly height',
  sourcePartCount: 'Outlined source parts',
  holeCount: 'Through holes',
  pocketCount: 'Blind cuts',
};
export function Requirements({
  value,
  disabled,
  onConfirm,
}: {
  value: AssistantRequirements;
  disabled?: boolean;
  onConfirm: (requirements: AssistantRequirements) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState('');
  useEffect(() => setDraft(value), [value]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(value);
  return (
    // Shown as a settings dialog section, which already is the disclosure: the form is open as soon as it is picked.
    <div className="cad-assistant-settings">
      <h3>Confirmed requirements{Object.keys(value).length ? ' · active' : ' · optional'}</h3>
      <p>
        These application checks stay outside generated scripts. Enter agreed values in mm; blank fields add no requirement. Outline checks
        use one unambiguous part. Appearance and strength still need review.
      </p>
      <fieldset disabled={disabled}>
        <legend>Design requirements</legend>
        <label>
          Part name or ID (blank means the single outlined part)
          <input value={draft.part ?? ''} onChange={event => setDraft({ ...draft, part: event.target.value || undefined })} />
        </label>
        {[...requirementLengths, 'sourcePartCount', 'holeCount', 'pocketCount'].map(key => (
          <label key={key}>
            {labels[key]}
            {requirementLengths.includes(key as (typeof requirementLengths)[number]) ? ' (mm)' : ''}
            <input
              type="number"
              min={key.endsWith('Count') ? 0 : 0.001}
              step={key.endsWith('Count') ? 1 : 'any'}
              value={((draft as Record<string, unknown>)[key] as number) ?? ''}
              onChange={event => setDraft({ ...draft, [key]: event.target.value ? Number(event.target.value) : undefined })}
            />
          </label>
        ))}
        <label>
          <input
            type="checkbox"
            checked={!!draft.preserveExistingIds}
            onChange={event => setDraft({ ...draft, preserveExistingIds: event.target.checked || undefined })}
          />
          Keep all existing entity IDs
        </label>
        {error && <p role="alert">{error}</p>}
        <button
          type="button"
          disabled={!dirty}
          onClick={() => {
            try {
              onConfirm(validateAssistantRequirements(draft));
              setError('');
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Invalid requirements.');
            }
          }}>
          Confirm requirements
        </button>
        <button
          type="button"
          disabled={!Object.keys(draft).length}
          onClick={() => {
            setDraft({});
            setError('');
          }}>
          Clear fields
        </button>
      </fieldset>
      {dirty && <p>Unconfirmed changes are not used by the assistant.</p>}
    </div>
  );
}
