import { describe, expect, it } from 'vitest';
import { lintScenario, parseMarker } from './lint.mjs';

const scenario = steps => ({ id: 'studio/extrude/example', steps });

describe('no extra inputs per spec step', () => {
  it('passes one allowed input per step, with checks and setup free', () => {
    const result = lintScenario(scenario([
      'closesketch',
      { spec: '1 select' }, 'selectfeature Top',
      { spec: '2 command' }, 'key Shift+S',
      { spec: '3 draw' }, 'rect 0,0 60,40', { expect: { entityCount: 4 } }, 'shot after-rect',
      { spec: '4 confirm' }, 'closesketch',
      { spec: '5 command' }, 'studiotool Extrude',
      { spec: '6 pick' }, 'viewpick 30,20,0',
      { spec: '7 field' }, 'dialogfill Depth = 10', 'key Enter',
      { spec: '8 confirm' }, 'key Enter',
      { spec: '9 view' }, 'view iso',
      'exportstep runs/latest/result.step',
    ]));
    expect(result).toMatchObject({ ok: true, steps: 9, setup: ['closesketch'], findings: [] });
  });
  it('reports a needed toggle before a pick as an extra input', () => {
    const result = lintScenario(scenario([{ spec: '1 pick' }, 'button Select profile', 'viewpick 30,20,0']));
    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([expect.objectContaining({ spec: '1 pick', problem: 'input not allowed for this kind', inputs: ['button Select profile', 'viewpick 30,20,0'] })]);
    expect(lintScenario(scenario([{ spec: '1 pick' }, 'viewpick 30,20,0', 'viewpick 70,20,0'])).findings[0].problem).toBe('1 extra input');
  });
  it('allows Enter only after a field, and refuses a missing input', () => {
    expect(lintScenario(scenario([{ spec: '1 confirm' }, 'key Enter', 'key Enter'])).ok).toBe(false);
    expect(lintScenario(scenario([{ spec: '1 field' }, 'dialogfill Depth = 10', 'key Enter', 'key Enter'])).findings[0].problem).toBe('1 extra input');
    expect(lintScenario(scenario([{ spec: '1 view' }, { spec: '2 view' }, 'view top'])).findings).toEqual([expect.objectContaining({ spec: '1 view', problem: 'no input' })]);
    expect(lintScenario(scenario([{ spec: '1 cancel' }, 'key Enter'])).ok).toBe(false);
  });
  it('refuses bad markers, out-of-order steps and a scenario without markers', () => {
    expect(parseMarker('3 wiggle').error).toMatch(/unknown spec step kind/);
    expect(parseMarker('pick').error).toMatch(/<n> <kind>/);
    expect(lintScenario(scenario([{ spec: '2 view' }, 'view top', { spec: '1 view' }, 'view iso'])).findings[0].problem).toMatch(/comes after/);
    expect(lintScenario(scenario(['rect 0,0 10,10'])).findings).toEqual([{ spec: null, problem: 'no spec markers' }]);
  });
});
