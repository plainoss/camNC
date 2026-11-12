import { describe, expect, it } from 'vitest';
import { kDefaultPlan, plannedReliefBit, withHoleChoice } from './planSettings';

describe('withHoleChoice', () => {
  it('keeps a choice per part and hole', () => {
    const one = withHoleChoice(kDefaultPlan, 'part-0', 2, 'clear');
    const two = withHoleChoice(one, 'part-0', 3, 'leave');
    expect(withHoleChoice(two, 'part-1', 2, 'leave').holes).toEqual({ 'part-0': { 2: 'clear', 3: 'leave' }, 'part-1': { 2: 'leave' } });
    expect(kDefaultPlan.holes).toBeUndefined();
  });

  it('no choice: size and time decide again', () => {
    const one = withHoleChoice(kDefaultPlan, 'part-0', 2, 'clear');
    expect(withHoleChoice(one, 'part-0', 2, undefined).holes).toEqual({ 'part-0': {} });
  });
});

describe('plannedReliefBit', () => {
  it("is the job's main bit, even with a smaller second bit, or the default bit without a plan", () => {
    const six = { number: 3, diameter: 6, name: '6 mm flat' };
    expect(plannedReliefBit({ bit: six })).toBe(6);
    expect(plannedReliefBit({ bit: six, smallBit: kDefaultPlan.bit })).toBe(6);
    expect(plannedReliefBit(undefined)).toBe(3.175);
  });
});
