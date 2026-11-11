import { requirementLengths, validateAssistantRequirements, type AssistantRequirements } from './requirements';

/** A typed answer the user fills in or confirms. A requirement name makes the answer an app-checked requirement. */
export interface AssistantQuestionField {
  name: string;
  label: string;
  unit: 'mm' | 'count';
  value?: number;
}

const counts = ['sourcePartCount', 'holeCount', 'pocketCount'] as const;
export const requirementFieldNames: readonly string[] = [...requirementLengths, ...counts];

export const questionFieldsSchema = {
  type: 'array',
  maxItems: 6,
  description:
    'Optional numeric answers shown as editable fields, prefilled with your proposed values. Use a requirement name (' +
    requirementFieldNames.join(', ') +
    ') when the answer is a finished dimension or count the app should check on every proposal; any other short name for other numbers.',
  items: {
    type: 'object',
    properties: {
      name: { type: 'string', maxLength: 40 },
      label: { type: 'string', maxLength: 40 },
      unit: { type: 'string', enum: ['mm', 'count'] },
      value: { type: 'number' },
    },
    required: ['name', 'label', 'unit'],
    additionalProperties: false,
  },
};

/** Provider output is data: anything malformed is dropped rather than shown. */
export function readQuestionFields(input: unknown): AssistantQuestionField[] {
  if (!Array.isArray(input)) return [];
  const fields: AssistantQuestionField[] = [];
  for (const item of input.slice(0, 6)) {
    if (!item || typeof item !== 'object') continue;
    const { name, label, unit, value } = item as Record<string, unknown>;
    if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(name) || fields.some(field => field.name === name)) continue;
    if (typeof label !== 'string' || !label.trim() || label.length > 40) continue;
    if (unit !== 'mm' && unit !== 'count') continue;
    const number = typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1_000_000 ? value : undefined;
    fields.push({ name, label: label.trim(), unit, ...(number !== undefined && { value: number }) });
  }
  return fields;
}

/** The answer as sent to the model, and the requirement part of it the app checks from now on. */
export function answerQuestionFields(
  fields: AssistantQuestionField[],
  values: Record<string, number | undefined>
): { text: string; requirements: AssistantRequirements } {
  const parts: string[] = [];
  const requirements: Record<string, number> = {};
  for (const field of fields) {
    const value = values[field.name];
    if (value === undefined || !Number.isFinite(value)) continue;
    parts.push(`${field.label}: ${value}${field.unit === 'mm' ? ' mm' : ''}`);
    if (requirementFieldNames.includes(field.name)) requirements[field.name] = field.unit === 'count' ? Math.round(value) : value;
  }
  let checked: AssistantRequirements = {};
  try {
    checked = validateAssistantRequirements(requirements);
  } catch {
    // An out-of-range value still answers the question in words; it just isn't enforced.
  }
  return { text: parts.join(', '), requirements: checked };
}
