import { describe, expect, it } from 'vitest';
import { lengthText, lengthUnitScale } from './designUnits';
import { parseCadValue } from './valueExpressions';

describe('a length as an edit field starts with', () => {
  it.each([
    [18, 'in', '0.70866'],
    [100, 'in', '3.93701'],
    [5, 'in', '0.19685'],
    [19.05, 'in', '0.75'],
    [25.4, 'in', '1'],
    [18, 'cm', '1.8'],
    [6, 'cm', '0.6'],
    [304.8, 'ft', '1'],
    [18, 'mm', '18'],
    [17.5, 'mm', '17.5'],
  ] as const)('shows %s mm in %s as %s', (value, unit, text) => {
    expect(lengthText(value, unit)).toBe(text);
  });

  it('keeps the size when the field is taken as it is', () => {
    for (const unit of ['in', 'cm', 'm', 'ft'] as const)
      for (const value of [0.1, 3, 6, 12.7, 18, 19.05, 100, 333.333, 2440])
        expect(Math.abs(Number(lengthText(value, unit)) * lengthUnitScale(unit) - value)).toBeLessThan(1e-4);
  });

  it('gives back the exact length for a rounded text left as it was', () => {
    const exact = 31.3580244091242;
    const text = lengthText(exact, 'in');
    expect(text).toBe('1.23457');
    expect(parseCadValue(text, { lengthUnit: 'in' })).toEqual({ value: exact });
    expect(parseCadValue(` ${text} `, { unit: 'mm', lengthUnit: 'in' })).toEqual({ value: exact });
    // Anything else is read as typed.
    expect((parseCadValue('1.23458', { lengthUnit: 'in' }) as { value: number }).value).toBeCloseTo(1.23458 * 25.4, 9);
    expect(parseCadValue(text, { unit: 'scalar', lengthUnit: 'in' })).toEqual({ value: 1.23457 });
    expect((parseCadValue(text, { lengthUnit: 'cm' }) as { value: number }).value).toBeCloseTo(12.3457, 9);
  });
});
