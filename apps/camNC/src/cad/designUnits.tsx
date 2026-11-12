import { createContext, useContext, useMemo } from 'react';
import { formatCadValue, type CadLengthUnit } from '@wbcnc/cad';
import { rememberShownLength } from './shownLengths';
import { parseCadValue } from './valueExpressions';

// Legacy documents without a preference retain millimeter input semantics.
export const DesignUnitContext = createContext<CadLengthUnit>('mm');
export const lengthUnitScale = (unit: CadLengthUnit) => ({ mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 })[unit];
/**
 * A length as an edit field starts with, in the design's unit: with the fewest decimals that keep it within 0.0001 mm,
 * so 18 mm reads `0.70866` in inches rather than every digit of the float. Taking the field as it is keeps the exact
 * length (see `shownLengths`).
 */
export function lengthText(value: number, unit: CadLengthUnit): string {
  const scale = lengthUnitScale(unit);
  if (unit === 'mm' || !Number.isFinite(value)) return String(value / scale);
  for (let decimals = 0; decimals < 8; decimals++) {
    const shown = +(value / scale).toFixed(decimals);
    if (Math.abs(shown * scale - value) < 1e-4) return remembered(String(shown), unit, value);
  }
  return remembered(String(+(value / scale).toFixed(8)), unit, value);
}

/** A rounded text, remembered with its exact length so a field left as it is keeps that length. */
function remembered(text: string, unit: CadLengthUnit, value: number) {
  if (Number(text) * lengthUnitScale(unit) !== value) rememberShownLength(text, unit, value);
  return text;
}

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
