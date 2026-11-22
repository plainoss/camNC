import { t as translate } from '@wbcnc/i18n';
import type { AssistantRequirements } from './requirements';

const mm = (value: unknown) => `${value} mm`;
const plural = (value: unknown, one: string, many: string) => `${value} ${value === 1 ? one : many}`;
const chipLabels: Record<keyof AssistantRequirements, (value: unknown) => string> = {
  part: value => `Part: ${value}`,
  width: value => `Width ${mm(value)}`,
  height: value => `Height ${mm(value)}`,
  thickness: value => `Thickness ${mm(value)}`,
  pocketDepth: value => `Pockets ${mm(value)} deep`,
  minimumFloor: value => `Floor ≥ ${mm(value)}`,
  minimumWall: value => `Wall ≥ ${mm(value)}`,
  assemblyWidth: value => translate('Assembly width {{value1}}', { value1: mm(value) }),
  assemblyDepth: value => translate('Assembly depth {{value1}}', { value1: mm(value) }),
  assemblyHeight: value => translate('Assembly height {{value1}}', { value1: mm(value) }),
  sourcePartCount: value => plural(value, 'part', 'parts'),
  holeCount: value => plural(value, 'hole', 'holes'),
  pocketCount: value => plural(value, 'pocket', 'pockets'),
  preserveExistingIds: () => translate('Keep existing IDs'),
};

function briefChipLabel(key: keyof AssistantRequirements, value: unknown) {
  return chipLabels[key]?.(value) ?? `${key}: ${value}`;
}

/**
 * The confirmed brief, pinned above the conversation: every proposal is checked against these by the app itself, not
 * by the generated script. Answers typed into question fields add to it; a chip's × removes one.
 */
export function BriefChips({
  value,
  disabled,
  onRemove,
  onEdit,
}: {
  value: AssistantRequirements;
  disabled?: boolean;
  onRemove: (key: keyof AssistantRequirements) => void;
  onEdit: () => void;
}) {
  const entries = Object.entries(value).filter(([, item]) => item !== undefined) as [keyof AssistantRequirements, unknown][];
  if (!entries.length) return null;
  return (
    <section className="cad-assistant-brief" aria-label={translate('Brief')}>
      <span className="cad-assistant-eyebrow">{translate('BRIEF · CHECKED ON EVERY PROPOSAL')}</span>
      <ul>
        {entries.map(([key, item]) => (
          <li key={key}>
            {briefChipLabel(key, item)}
            <button
              type="button"
              aria-label={translate('Remove {{value1}}', { value1: briefChipLabel(key, item) })}
              disabled={disabled}
              onClick={() => onRemove(key)}>
              ×
            </button>
          </li>
        ))}
        <li>
          <button type="button" className="cad-assistant-brief-edit" disabled={disabled} onClick={onEdit}>
            {translate('Edit ')}
          </button>
        </li>
      </ul>
    </section>
  );
}
