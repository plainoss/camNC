import type { CadLengthUnit, CadValueResult, CadValueUnit } from '@wbcnc/cad';

/**
 * The exact length behind each rounded text a field was given, such as `0.70866` in for 18 mm. Dialogs read every field
 * again when one changes, so a field left as it was gives back the length it showed rather than its rounded text's.
 * Two lengths that round alike are within 0.0001 mm of each other, so either one is right for the text.
 */
const shown = new Map<string, number>();
const kMaxShown = 2000;
const key = (text: string, unit: CadLengthUnit) => `${unit}:${text.trim()}`;

export function rememberShownLength(text: string, unit: CadLengthUnit, value: number) {
  const at = key(text, unit);
  shown.delete(at);
  shown.set(at, value);
  // The oldest go first: they belong to fields long closed.
  if (shown.size > kMaxShown) shown.delete(shown.keys().next().value!);
}

/** The length a field's untouched rounded text stands for, or null when it was typed or isn't rounded. */
export function shownLength(text: string, options: { unit?: CadValueUnit; lengthUnit?: CadLengthUnit } = {}): CadValueResult | null {
  const { unit = 'mm', lengthUnit = 'mm' } = options;
  if (unit !== 'mm' || lengthUnit === 'mm') return null;
  const value = shown.get(key(text, lengthUnit));
  return value === undefined ? null : { value };
}
