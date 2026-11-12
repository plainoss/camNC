import type { SketchProblemLists } from '@wbcnc/cad-editor/sketchFeedback';

/** Before the first check of the sketches there's nothing to report. */
export const noSketchProblems = (): SketchProblemLists => ({ problems: [], sketchProblems: [] });

/** A check that fails outright holds the open sketch with its error. */
export function failedCheckProblems(error: unknown): SketchProblemLists {
  const problems = [error instanceof Error ? error.message : String(error)];
  return { problems, sketchProblems: problems };
}
