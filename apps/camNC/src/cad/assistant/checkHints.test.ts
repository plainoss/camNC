import { describe, expect, it } from 'vitest';
import { checkNextStep } from './checkHints';

describe('checkNextStep', () => {
  it('names the repair for a known error and forbids a proposal', () => {
    const next = checkNextStep({
      ok: false,
      report: { errors: [{ code: 'parts-collide', message: 'Side and Shelf both need the material.' }] },
    });
    expect(next).toMatch(/^Not a valid candidate yet\. Do not reply with Proposal:/);
    expect(next).toContain('Side and Shelf both need the material.');
    expect(next).toContain('d.cutParts');
  });

  it('falls back to the message, lists unmet requirements and caps the steps', () => {
    const errors = Array.from({ length: 5 }, (_, index) => ({ code: `odd-${index}`, message: `Problem ${index}` }));
    const next = checkNextStep({
      ok: false,
      report: { errors },
      requirements: [{ requirement: 'minimumWall', passed: false, expected: 18, actual: 12 }],
    });
    expect(next).toContain('odd-0: Problem 0');
    expect(next).toContain('(+2 more)');
    const requirement = checkNextStep({
      ok: false,
      report: {},
      requirements: [{ requirement: 'minimumWall', passed: false, expected: 18, actual: 12 }],
    });
    expect(requirement).toContain('Requirement minimumWall is not met (wanted 18, got 12)');
  });

  it('tells a stopped script to fix its line', () => {
    expect(checkNextStep({ ok: false, scriptError: 'TypeError: x is undefined (script line 3: x.y)' })).toMatch(
      /nothing was built.*Do not reply with Proposal:/
    );
  });

  it('sends a passing geometry-only check to finalize_design and a complete one to Proposal:', () => {
    expect(checkNextStep({ ok: true, report: {}, stage: 'geometry-only' })).toContain('call finalize_design');
    expect(checkNextStep({ ok: true, report: { warnings: [{ code: 'thin-profile' }] }, stage: 'complete' })).toMatch(
      /warnings \(thin-profile\).*Proposal: and mention the remaining warnings/
    );
    // An unused sketch is not a problem with the design.
    expect(checkNextStep({ ok: true, report: { warnings: [{ code: 'empty-sketch' }] }, stage: 'complete' })).not.toContain('warnings');
  });
});
