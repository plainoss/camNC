import { t as translate } from '@wbcnc/i18n';
/**
 * A number as typed in a CAM field: dot or comma decimals ("0.3", "0,3"), nothing else. NaN for anything that isn't
 * a plain number, so "3 mm" or "1e3" are errors instead of being read as 3 or 1000.
 */
export function parseDecimal(text: string): number {
  const t = text.trim().replace(',', '.');
  return /^-?(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : NaN;
}

/** A number for a CAM field: always a dot, at most `digits` decimals, no trailing zeros ("1.59", "0.3", "15000"). */
export const fmtDecimal = (v: number, digits = 2) => `${+v.toFixed(digits)}`;

export interface NumberRange {
  min?: number;
  max?: number;
  /** `min` itself is not allowed (e.g. a feed must be > 0). */
  minExclusive?: boolean;
  integer?: boolean;
  /** Unit after the range in the error: "mm". */
  unit?: string;
}

/** Why `text` is no valid value, in words for the field's inline error; null when it is fine. */
export function numberProblem(text: string, { min, max, minExclusive, integer, unit }: NumberRange): string | null {
  const v = parseDecimal(text);
  const u = unit ? ` ${unit}` : '';
  const range =
    min !== undefined && max !== undefined
      ? `${fmtDecimal(min, 3)}–${fmtDecimal(max, 3)}${u}`
      : min !== undefined
        ? `${minExclusive ? translate('more than') : translate('at least')} ${fmtDecimal(min, 3)}${u}`
        : max !== undefined
          ? translate('at most {{value1}}{{value2}}', { value1: fmtDecimal(max, 3), value2: u })
          : '';
  if (!Number.isFinite(v)) return translate('Enter a number{{value1}}, with a dot for decimals.', { value1: range ? `, ${range}` : '' });
  if (integer && !Number.isInteger(v)) return translate('Enter a whole number{{value1}}.', { value1: range ? `, ${range}` : '' });
  const low = min !== undefined && (minExclusive ? v <= min : v < min);
  const high = max !== undefined && v > max;
  if (low || high) return translate('{{value1}} is out of range: {{value2}}.', { value1: v, value2: range });
  return null;
}
