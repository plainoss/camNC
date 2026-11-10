import { describe, expect, it } from 'vitest';
import { isBareBaseUnitLiteral } from './dimensionExpressions';

describe('base-unit dimension expressions', () => {
  it('classifies only finite, matching base-unit literals and unambiguous decimals', () => {
    expect(isBareBaseUnitLiteral('50,25 MM', 'mm', 50.25)).toBe(true);
    expect(isBareBaseUnitLiteral(' 45 ° ', 'deg', 45)).toBe(true);
    expect(isBareBaseUnitLiteral('1e-999mm', 'mm', 0)).toBe(false);
    expect(isBareBaseUnitLiteral('1,000mm', 'mm', 1000)).toBe(false);
    expect(isBareBaseUnitLiteral('50deg', 'mm', 50)).toBe(false);
    expect(isBareBaseUnitLiteral('50mm', 'deg', 50)).toBe(false);
    expect(isBareBaseUnitLiteral('50.0000000000001mm', 'mm', 50)).toBe(true);
    expect(isBareBaseUnitLiteral('50.001mm', 'mm', 50)).toBe(false);
  });
});
