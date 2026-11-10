import { createContext, useContext, useMemo } from 'react';
import { formatCadValue, parseCadValue, type CadLengthUnit } from '@wbcnc/cad';

// Legacy documents without a preference retain millimeter input semantics.
export const DesignUnitContext = createContext<CadLengthUnit>('mm');
export const lengthUnitScale = (unit: CadLengthUnit) => ({ mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 })[unit];
export const lengthText = (value: number, unit: CadLengthUnit) => String(value / lengthUnitScale(unit));

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
