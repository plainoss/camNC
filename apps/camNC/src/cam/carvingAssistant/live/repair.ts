import type { Evaluation } from './evaluate';

/**
 * The follow-up brief for one automatic repair turn: the original brief plus machine-readable findings from the
 * local checks (kind, viewBox location, measured vs needed width, first sanitize error) and what to change.
 * Sent with the previous SVG as `previous`, so it uses the existing revise path.
 */
export function repairBrief(prompt: string, first: { generationError?: string; evaluation?: Evaluation }): string {
  const e = first.evaluation;
  if (!e) return prompt;
  const findings = {
    sanitizeError: e.sanitizeError,
    errors: e.errors.length ? e.errors : undefined,
    removedCutAreaFraction: e.removedCutAreaFraction === undefined ? undefined : Number(e.removedCutAreaFraction.toFixed(3)),
    removedCutAreaLimit: 0.1,
    narrowLandAreaMm2: e.narrowLandAreaMm2 === undefined ? undefined : Number(e.narrowLandAreaMm2.toFixed(1)),
    mmPerViewBoxUnit: e.mmPerUnit === undefined ? undefined : Number(e.mmPerUnit.toFixed(4)),
    spots: e.findings.slice(0, 10),
  };
  const fix = e.sanitizeError
    ? 'The previous SVG was rejected before any geometry check. Fix the rejected markup and keep the drawing.'
    : 'Keep the subject and composition. At each spot, widen the black stroke (removed-black) or the white gap (narrow-white) to at least neededWidth viewBox units, or merge/remove that detail. Thicken all similar thin strokes too, not only the listed spots.';
  return `${prompt}

Revise the previous SVG: local carving checks rejected it.
${fix}
Findings: ${JSON.stringify(findings)}`;
}
