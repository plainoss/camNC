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
  assemblyWidth: value => `Assembly width ${mm(value)}`,
  assemblyDepth: value => `Assembly depth ${mm(value)}`,
  assemblyHeight: value => `Assembly height ${mm(value)}`,
  sourcePartCount: value => plural(value, 'part', 'parts'),
  holeCount: value => plural(value, 'hole', 'holes'),
  pocketCount: value => plural(value, 'pocket', 'pockets'),
  preserveExistingIds: () => 'Keep existing IDs',
};

export function briefChipLabel(key: keyof AssistantRequirements, value: unknown) {
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
    <section className="cad-assistant-brief" aria-label="Brief">
      <span className="cad-assistant-eyebrow">BRIEF · CHECKED ON EVERY PROPOSAL</span>
      <ul>
        {entries.map(([key, item]) => (
          <li key={key}>
            {briefChipLabel(key, item)}
            <button type="button" aria-label={`Remove ${briefChipLabel(key, item)}`} disabled={disabled} onClick={() => onRemove(key)}>
              ×
            </button>
          </li>
        ))}
        <li>
          <button type="button" className="cad-assistant-brief-edit" disabled={disabled} onClick={onEdit}>
            Edit
          </button>
        </li>
      </ul>
    </section>
  );
}
