import { describe, expect, it } from 'vitest';
import { cadFieldText, lengthText, lengthUnitScale, shownLengthText } from './designUnits';

describe('a length as a field shows it', () => {
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
    [17.123456789, 'mm', '17.123456789'],
  ] as const)('shows %s mm in %s as %s', (value, unit, text) => {
    expect(shownLengthText(lengthText(value, unit), unit)).toBe(text);
  });

  it('stays within 0.0001 mm, and keeps the field’s own text exact', () => {
    for (const unit of ['in', 'cm', 'm', 'ft'] as const)
      for (const value of [0.1, 3, 6, 12.7, 18, 19.05, 100, 333.333, 2440]) {
        expect(Number(lengthText(value, unit)) * lengthUnitScale(unit)).toBeCloseTo(value, 9);
        expect(Math.abs(Number(shownLengthText(lengthText(value, unit), unit)) * lengthUnitScale(unit) - value)).toBeLessThan(1e-4);
      }
  });

  it('shows anything but a plain number as it is', () => {
    expect(shownLengthText('t + 0.70866141732', 'in')).toBe('t + 0.70866141732');
    expect(shownLengthText('(0.7086614173228347) in', 'in')).toBe('(0.7086614173228347) in');
  });
});

it('reads a field as its owner means it: exact while it shows what it was given, typed once edited', () => {
  const input = document.createElement('input');
  expect(cadFieldText(null, '18')).toBe('18');
  input.value = '0.70866';
  input.dataset.exactLength = lengthText(18, 'in');
  input.dataset.shownLength = '0.70866';
  expect(cadFieldText(input, '')).toBe(lengthText(18, 'in'));
  input.value = '0.7087';
  expect(cadFieldText(input, '')).toBe('0.7087');
});
