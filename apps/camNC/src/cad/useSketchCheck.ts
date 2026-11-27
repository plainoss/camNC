import type { CadDocument, CadSketchSolveStatus, CadSolveResult } from '@wbcnc/cad';
import type { CadSession } from '@wbcnc/cad-editor/session';
import { sketchFeedback } from '@wbcnc/cad-editor/sketchFeedback';
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { AnnotationGesture, DragGesture } from './editorGestures';
import { failedCheckProblems, noSketchProblems } from './sketchProblemLists';
import { solveCadDocument } from './solveCad';

interface SketchCheckInput {
  doc: CadDocument;
  session: CadSession;
  /** Bumped to check the same revision again, as after an acceptance or when an extrude dialog opens or closes. */
  checkEpoch: number;
  sketchOnly: boolean;
  /** The revision last checked, as `${id}:${revision}`: a revision already checked isn't checked again. */
  lastCheckedRevision: RefObject<string>;
  finishing: RefObject<boolean>;
  drag: RefObject<DragGesture | null>;
  annotationDrag: RefObject<AnnotationGesture | null>;
  documentRef: RefObject<CadDocument>;
  setDocument: (next: CadDocument) => void;
  callbacks: RefObject<{ onDraftChange: (document: CadDocument) => void }>;
  normalizePatternVariableSource: (before: CadDocument, after: CadDocument) => void;
  solveFeedback: (result: CadSolveResult) => CadSolveResult;
}

/**
 * The CAD editor's sketch check: each new revision of the design is solved in the background, and what the solver
 * reports becomes the editor's status, problems and per-part sketch states.
 */
export function useSketchCheck({
  doc,
  session,
  checkEpoch,
  sketchOnly,
  lastCheckedRevision,
  finishing,
  drag,
  annotationDrag,
  documentRef,
  setDocument,
  callbacks,
  normalizePatternVariableSource,
  solveFeedback,
}: SketchCheckInput) {
  const [conflictedConstraints, setConflictedConstraints] = useState<string[]>([]);
  const [status, setStatus] = useState('Checking sketch…');
  const [{ problems, sketchProblems, featureProblems, unbuiltParts }, setProblems] = useState(noSketchProblems);
  const [inProgress, setInProgress] = useState(false);
  const [solving, setSolving] = useState(true);
  const [sketchStatuses, setSketchStatuses] = useState<Record<string, CadSketchSolveStatus>>({});
  const solveSequence = useRef(0);

  useEffect(() => {
    if (finishing.current || drag.current || annotationDrag.current || lastCheckedRevision.current === `${doc.id}:${doc.revision}`) return;
    let cancelled = false;
    const sequence = ++solveSequence.current;
    setSolving(true);
    void solveCadDocument(doc, { classifyEntities: true, sketchOnly })
      .then(result => {
        if (cancelled || sequence !== solveSequence.current || drag.current || annotationDrag.current) return;
        lastCheckedRevision.current = `${doc.id}:${doc.revision}`;
        setSolving(false);
        const feedback = sketchFeedback(solveFeedback(result));
        setProblems(feedback);
        setConflictedConstraints(feedback.conflictedConstraintIds);
        setInProgress(feedback.inProgress);
        // A part's profile comes first and is what the editor shows, whatever its face sketches report.
        setSketchStatuses(Object.fromEntries([...result.sketches].reverse().map(state => [state.partId, state])));
        setStatus(feedback.status);
        // Solver normalization belongs to the same user command, never another undo entry.
        if (result.sketches.some(s => s.status === 'solved') && JSON.stringify(result.document) !== JSON.stringify(documentRef.current)) {
          normalizePatternVariableSource(doc, result.document);
          session.document = result.document;
          documentRef.current = result.document;
          setDocument(result.document);
          callbacks.current.onDraftChange(result.document);
        }
      })
      .catch(error => {
        if (cancelled || sequence !== solveSequence.current) return;
        lastCheckedRevision.current = `${doc.id}:${doc.revision}`;
        setSolving(false);
        setProblems(failedCheckProblems(error));
        setInProgress(false);
        setStatus('Sketch could not be checked');
      });
    return () => {
      cancelled = true;
    };
    // The refs and the setter passed in are stable: a check follows only these, as it did inside CadEditor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, session, checkEpoch, sketchOnly, normalizePatternVariableSource, solveFeedback]);

  return { conflictedConstraints, status, problems, sketchProblems, featureProblems, unbuiltParts, inProgress, solving, sketchStatuses };
}
