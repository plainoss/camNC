import { createContext, useContext, useMemo } from 'react';
import { formatCadValue, parseCadValue, type CadLengthUnit } from '@wbcnc/cad';

// Legacy documents without a preference retain millimeter input semantics.
export const DesignUnitContext = createContext<CadLengthUnit>('mm');
export const lengthUnitScale = (unit: CadLengthUnit) => ({ mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 })[unit];
/** A length as a field's text, in the design's unit with every digit, so taking the field as it is keeps the length. */
export const lengthText = (value: number, unit: CadLengthUnit) => String(value / lengthUnitScale(unit));

const plainNumber = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
/**
 * A field's plain number as it's shown, in a design measured in `unit`: with the fewest decimals that keep it within
 * 0.0001 mm, so 18 mm reads `0.70866` in inches rather than `0.7086614173228347`. Anything else is shown as it is.
 */
export function shownLengthText(text: string, unit: CadLengthUnit): string {
  if (unit === 'mm' || !plainNumber.test(text)) return text;
  const scale = lengthUnitScale(unit),
    value = Number(text) * scale;
  if (!Number.isFinite(value)) return text;
  for (let decimals = 0; decimals < 8; decimals++) {
    const shown = String(+(value / scale).toFixed(decimals));
    if (Math.abs(Number(shown) * scale - value) < 1e-4) return shown.length < text.length ? shown : text;
  }
  return text;
}

/**
 * A value field's text as its owner means it: the exact length while the field still shows the rounded one it was
 * given (`CadValueInput` marks it), otherwise what's in it. For an owner that reads the field itself.
 */
export const cadFieldText = (input: HTMLInputElement | null, otherwise: string) =>
  !input
    ? otherwise
    : input.dataset.shownLength !== undefined && input.value === input.dataset.shownLength
      ? input.dataset.exactLength!
      : input.value;

export function useDesignUnits(preference?: CadLengthUnit) {
  const inherited = useContext(DesignUnitContext);
  const lengthUnit = preference ?? inherited;
  return useMemo(
    () => ({
      lengthUnit,
      lengthText: (value: number) => lengthText(value, lengthUnit),
      formatLength: (value: number) => formatCadValue(value / lengthUnitScale(lengthUnit)),
      parseCadValue: (text: string, options: Parameters<typeof parseCadValue>[1] = {}) => parseCadValue(text, { ...options, lengthUnit }),
    }),
    [lengthUnit]
  );
}
