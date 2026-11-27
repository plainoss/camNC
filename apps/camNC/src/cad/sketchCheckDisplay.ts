import type { CadDocument, CadSketch, CadSketchSolveStatus } from '@wbcnc/cad';
import { constraintColorNotice, isEmptySketch, sketchDofStatus } from '@wbcnc/cad-editor/sketchFeedback';
import { sketchStrokeColor } from './sketchAppearance';

interface SketchCheckDisplayInput {
  doc: CadDocument;
  partId: string | undefined;
  sketch: CadSketch | undefined;
  /** What the editor's sketch check last reported. */
  sketchStatuses: Record<string, CadSketchSolveStatus>;
  conflictedConstraints: readonly string[];
  /** The constraints of variables that can't be followed. */
  variableConstraintIds: readonly string[];
  problems: string[];
  sketchProblems: string[];
  status: string;
  inProgress: boolean;
  solving: boolean;
  /** The revision the check last finished, as `${id}:${revision}`. */
  lastCheckedRevision: string;
  /** A sketch open from the Part Studio, rather than the studio itself or a sketch-only session. */
  studioSketchOpen: boolean;
  /** A drag or a command preview is showing a sketch other than the one checked. */
  previewing: boolean;
}

/** How the open sketch shows what its check found: its status line, its problems, and the colours of its geometry. */
export function sketchCheckDisplay({
  doc,
  partId,
  sketch,
  sketchStatuses,
  conflictedConstraints,
  variableConstraintIds,
  problems,
  sketchProblems,
  status,
  inProgress,
  solving,
  lastCheckedRevision,
  studioSketchOpen,
  previewing,
}: SketchCheckDisplayInput) {
  const activeSketchStatus = sketchStatuses[partId ?? ''];
  // A dimension that can't follow its variables shows like a conflicting one.
  const shownConflicts = [...conflictedConstraints, ...variableConstraintIds];
  // A studio sketch closes whatever its edit did to the features built from it, which show as broken in the feature list.
  const openSketchProblems = studioSketchOpen ? sketchProblems : problems;
  const displayStatus =
    activeSketchStatus?.status === 'solved' && (inProgress || !openSketchProblems.length)
      ? sketchDofStatus(activeSketchStatus.dof, isEmptySketch(sketch))
      : status;
  const currentSolverResult = !solving && lastCheckedRevision === `${doc.id}:${doc.revision}`;
  const colorNotice = currentSolverResult ? constraintColorNotice(activeSketchStatus) : undefined;
  const entityStatus =
    currentSolverResult && !previewing && activeSketchStatus?.status === 'solved' ? activeSketchStatus.entityStatus : undefined;
  const stroke = sketchStrokeColor(activeSketchStatus, currentSolverResult);
  return { activeSketchStatus, shownConflicts, openSketchProblems, displayStatus, colorNotice, entityStatus, stroke };
}
