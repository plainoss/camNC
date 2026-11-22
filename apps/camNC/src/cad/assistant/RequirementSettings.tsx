import { t as translate } from '@wbcnc/i18n';
import { useEffect, useState } from 'react';
import { requirementLengths, validateAssistantRequirements, type AssistantRequirements } from './requirements';

const labels: Record<string, string> = {
  width: translate('Part outline width'),
  height: translate('Part outline height'),
  thickness: translate('Part thickness'),
  pocketDepth: translate('Every blind cut depth'),
  minimumFloor: translate('Minimum pocket floor'),
  minimumWall: translate('Minimum outer top-pocket wall'),
  assemblyWidth: translate('Assembly width'),
  assemblyDepth: translate('Assembly depth'),
  assemblyHeight: translate('Assembly height'),
  sourcePartCount: translate('Outlined source parts'),
  holeCount: translate('Through holes'),
  pocketCount: translate('Blind cuts'),
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
      <h3>
        {translate('Confirmed requirements')}
        {Object.keys(value).length ? translate(' · active') : translate(' · optional')}
      </h3>
      <p>
        {translate(
          'These application checks stay outside generated scripts. Enter agreed values in mm; blank fields add no requirement. Outline checks use one unambiguous part. Appearance and strength still need review. '
        )}
      </p>
      <fieldset disabled={disabled}>
        <legend>{translate('Design requirements')}</legend>
        <label>
          {translate('Part name or ID (blank means the single outlined part) ')}
          <input value={draft.part ?? ''} onChange={event => setDraft({ ...draft, part: event.target.value || undefined })} />
        </label>
        {[...requirementLengths, 'sourcePartCount', 'holeCount', 'pocketCount'].map(key => (
          <label key={key}>
            {labels[key]}
            {requirementLengths.includes(key as (typeof requirementLengths)[number]) ? translate(' (mm)') : ''}
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
          {translate('Keep all existing entity IDs ')}
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
              setError(cause instanceof Error ? cause.message : translate('Invalid requirements.'));
            }
          }}>
          {translate('Confirm requirements ')}
        </button>
        <button
          type="button"
          disabled={!Object.keys(draft).length}
          onClick={() => {
            setDraft({});
            setError('');
          }}>
          {translate('Clear fields ')}
        </button>
      </fieldset>
      {dirty && <p>{translate('Unconfirmed changes are not used by the assistant.')}</p>}
    </div>
  );
}
