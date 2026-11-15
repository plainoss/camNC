import type { CadDocument, CadSolveResult } from '@wbcnc/cad';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { designSteps, rolledBackTo } from '@wbcnc/cad';
import { apartExtrudePreview, apartPartIds, withoutApartRegionProblem } from './apartExtrudePreview';
import { offerFinalPreview } from './finalPreview';
import { unpickedExtrudePreview, withoutUnpickedProblem } from './unpickedExtrude';
import { editedStepId, type StudioDialog } from './studioDialog';

interface PreviewOptions {
  document: CadDocument;
  enabled: boolean;
  blank: boolean;
  rolledTo: string | null;
  dialog: StudioDialog | null;
  /** The sketch step open for editing: the design is rolled back to it while it's edited, as for a feature dialog. */
  sketching?: string | null;
  /** The editor's sketch check, run again when an extrude dialog opens or closes: its problems depend on it. */
  checks: { lastCheckedRevision: RefObject<string>; setCheckEpoch: (next: (epoch: number) => number) => void };
}

/** Every feature dialog shares the same rollback and explicit Final preview behavior. */
export function useFeaturePreview({ document, enabled, blank, rolledTo, dialog, sketching, checks }: PreviewOptions) {
  const ids = designSteps(document).map(step => step.id);
  const candidate = editedStepId(document, dialog);
  const editingStep = enabled && candidate && ids.includes(candidate) ? candidate : null;
  // Where the user put the bar, whatever dialog is open: what an export of the shown design stops at.
  const userRollback = enabled && rolledTo && ids.includes(rolledTo) ? rolledTo : null;
  const sketchStep = !enabled && sketching && ids.includes(sketching) ? sketching : null;
  const rollbackStep = enabled ? (editingStep ?? userRollback) : sketchStep;
  // Tie Final to the edited step so switching dialogs never renders a later feature with a stale Final toggle.
  const edited = editingStep ?? sketchStep;
  const [finalStep, setFinalStep] = useState<string | null>(null);
  const showFinal = !!edited && finalStep === edited;
  const offersFinal = !!edited && ids.at(-1) !== edited;
  useEffect(() => setFinalStep(null), [edited]);
  useEffect(() => {
    offerFinalPreview(offersFinal ? { shown: showFinal, toggle: () => setFinalStep(showFinal ? null : edited) } : null);
    return () => offerFinalPreview(null);
  }, [offersFinal, showFinal, edited]);
  const rolledBack = rollbackStep && !(offersFinal && showFinal) ? rollbackStep : null;
  const extrudingId = enabled && dialog?.kind === 'extrude' ? dialog.partId : null;
  // One dialog's split parts keep their ids, so what's hidden, made transparent or picked in the preview is what OK makes.
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- a new dialog starts new ids.
  const apartIds = useMemo(() => apartPartIds(), [dialog]);
  const shownDocument = useMemo(
    () =>
      blank
        ? { ...document, parts: [] }
        : unpickedExtrudePreview(
            apartExtrudePreview(rolledBack ? rolledBackTo(document, rolledBack) : document, extrudingId, apartIds),
            extrudingId
          ),
    [document, blank, rolledBack, extrudingId, apartIds]
  );
  // The steps below the bar the user rolled to: left out of the view, whatever their eye was set to. A feature dialog's
  // own rollback leaves them be: its preview is rolled back, but the sketches after it stay shown to pick from.
  const rolledByUser = edited ? null : rolledBack;
  const pastRollback = useMemo<ReadonlySet<string>>(() => {
    const steps = rolledByUser ? designSteps(document).map(step => step.id) : [];
    return new Set(steps.slice(steps.indexOf(rolledByUser!) + 1));
  }, [document, rolledByUser]);
  // Read when a solve ends. Opening or closing the dialog checks the design again, as its problems depend on the dialog.
  const extruding = useRef<string | null>(null);
  const { lastCheckedRevision, setCheckEpoch } = checks;
  useEffect(() => {
    if (extruding.current === extrudingId) return;
    extruding.current = extrudingId;
    lastCheckedRevision.current = '';
    setCheckEpoch(epoch => epoch + 1);
  }, [extrudingId, lastCheckedRevision, setCheckEpoch]);
  const solveFeedback = useCallback(
    (result: CadSolveResult) => withoutUnpickedProblem(withoutApartRegionProblem(result, extruding.current), extruding.current),
    []
  );
  return { rollbackStep, userRollback, rolledBack, shownDocument, pastRollback, solveFeedback, apartIds };
}
