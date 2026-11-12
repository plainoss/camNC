import { standaloneSketchPoints, type CadSketch, type CadSketchSolveStatus, type CadSolveResult } from '@wbcnc/cad';

export function constraintColorNotice(status?: CadSketchSolveStatus): string | undefined {
  if (status?.status !== 'solved' || status.entityAnalysis?.complete !== false) return;
  return status.entityAnalysis.limitedBy === 'engine-reset'
    ? 'Sketch solved; constraint color analysis reset'
    : 'Sketch solved; some constraint colors unavailable';
}

/**
 * What a sketch drawn as a whole part's outline gets wrong itself, found when that outline is made: these still hold
 * the sketch open. Anything else after the sketches solved belongs to a feature built from them.
 */
const PROFILE_CODES = new Set([
  'thin-profile',
  'missing-point',
  'invalid-curve',
  'invalid-curve-endpoints',
  'zero-length',
  'invalid-arc-endpoints',
  'open-profile',
  'ambiguous-profile',
  'curve-complexity',
  'intersecting-profiles',
  'empty-sketch',
  'degenerate-profile',
  'self-intersection',
  'disconnected-profile',
  'nested-island',
]);

/** An open wire is normal while sketching; conflicting constraints and bad geometry are errors. */
export function sketchFeedback(result: CadSolveResult) {
  const issues = result.diagnostics.filter(d => d.severity === 'error');
  const nativeSolved = result.sketches.length > 0 && result.sketches.every(s => s.status === 'solved');
  const inProgress = nativeSolved && issues.length > 0 && issues.every(d => d.code === 'open-profile' || d.code === 'empty-sketch');
  // Each part's profile comes first. Its face sketches are hidden here, so their freedom isn't reported as the profile's.
  const profiles = result.sketches.filter((s, i, all) => all.findIndex(other => other.partId === s.partId) === i);
  const free = profiles.reduce((sum, s) => sum + s.dof, 0);
  const empty = result.document.parts.every(p => isEmptySketch(p.sketch));
  const status = issues.some(issue => issue.code === 'solver-restarted')
    ? 'Sketch solver reset'
    : result.status === 'conflict'
      ? 'Conflicting constraints'
      : result.status === 'invalid' && !inProgress
        ? 'Sketch needs attention'
        : sketchDofStatus(free, empty);
  return {
    status,
    inProgress,
    problems: [...new Set(issues.map(d => d.message))],
    /** What only the sketches got wrong: a feature built from them, broken by an edit, doesn't stop one closing. */
    sketchProblems: [...new Set(issues.filter(d => !result.featuresEvaluated || PROFILE_CODES.has(d.code)).map(d => d.message))],
    conflictedConstraintIds: [...new Set(issues.flatMap(d => d.constraintIds ?? []))],
  };
}

/** Whether a sketch holds nothing drawn: points on their own count, as they're what a sketch for Hole holds. */
export function isEmptySketch(sketch: CadSketch | undefined): boolean {
  return !sketch?.entities.some(e => e.type !== 'point' && !e.construction) && !(sketch && standaloneSketchPoints(sketch).length);
}

export function sketchDofStatus(dof: number, empty: boolean): string {
  return empty ? 'Empty sketch' : dof ? `${dof} ${dof === 1 ? 'degree' : 'degrees'} of freedom` : 'Fully constrained';
}
