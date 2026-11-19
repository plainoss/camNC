import { partCutInputProblems, type CadDocument, type CadSketchSolveStatus } from '@wbcnc/cad';

/**
 * Why a part can't take its current values, for the mark beside it in the Parts list: a value in error, a Cut parts
 * step that can't use it as a tool or target, or a sketch that can't be solved.
 */
export function partTrouble(
  document: CadDocument,
  variableProblems: readonly { partId?: string; message: string }[],
  sketchStatuses: Readonly<Record<string, CadSketchSolveStatus>>,
  id: string
): string | null {
  return (
    [...variableProblems, ...partCutInputProblems(document)].find(problem => problem.partId === id)?.message ??
    (sketchStatuses[id]?.status === 'conflict' ? 'This part’s sketch can’t be solved with its current values.' : null)
  );
}
