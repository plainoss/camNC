import type { CadReport, CadReportIssue } from '@wbcnc/cad-script';

type Body = NonNullable<CadReport['assembly']>['parts'][number];
const round = (value: number) => Math.round(value);
/**
 * Close enough to be held: an inset door's reveal, a shelf's clearance between sides on pins or a drawer's running gap
 * are a few millimetres, so only a part farther than this from every other part counts as touching nothing.
 */
const kHeldWithin = 5;
const touches = (a: Body, b: Body, tolerance = kHeldWithin) =>
  [0, 1, 2].every(axis => a.at[axis]! <= b.at[axis]! + b.size[axis]! + tolerance && b.at[axis]! <= a.at[axis]! + a.size[axis]! + tolerance);

/** Rough physical sanity from placed boxes only: a part touching nothing, a tall piece on a small footprint, a thin stick. */
export function structuralWarnings(report: CadReport): CadReportIssue[] {
  const bodies = report.assembly?.parts ?? [];
  if (!bodies.length) return [];
  const warnings: CadReportIssue[] = [];
  const low = [0, 1, 2].map(axis => Math.min(...bodies.map(body => body.at[axis]!)));
  const high = [0, 1, 2].map(axis => Math.max(...bodies.map(body => body.at[axis]! + body.size[axis]!)));
  if (bodies.length > 1)
    for (const body of bodies)
      if (!bodies.some(other => other !== body && touches(body, other)))
        warnings.push({
          code: 'floating-part',
          part: body.name,
          message: `${body.name} touches no other part, so nothing holds it. Move it onto or into a neighbouring part and join it.`,
        });
  const height = high[2]! - low[2]!,
    footprint = Math.min(high[0]! - low[0]!, high[1]! - low[1]!);
  // A lone board is a component, not a freestanding piece.
  if (bodies.length > 1 && footprint > 0 && height / footprint > 3)
    warnings.push({
      code: 'may-tip',
      message: `The piece is ${round(height)} mm tall on a ${round(footprint)} mm footprint (${(height / footprint).toFixed(1)}:1). Freestanding, it can tip: widen or deepen the base, or tell the user it must be fixed to a wall.`,
    });
  for (const body of bodies) {
    const across = Math.max(body.size[0]!, body.size[1]!);
    // Ordinary legs (30 × 30 × 650 mm, about 22:1) are fine; a stick under 25 mm across at more than 25:1 is not.
    if (across < 25 && body.size[2]! / across > 25)
      warnings.push({
        code: 'slender-part',
        part: body.name,
        message: `${body.name} is ${round(body.size[2]!)} mm tall but only ${round(across)} mm across; it may flex or break under load. Thicken it or brace it, or tell the user.`,
      });
  }
  return warnings;
}
