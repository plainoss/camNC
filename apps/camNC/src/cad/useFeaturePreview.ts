import type { CadDocument } from '@wbcnc/cad';
import { useEffect, useMemo, useState } from 'react';
import { designSteps, rolledBackTo } from '@wbcnc/cad';
import { offerFinalPreview } from './finalPreview';

interface PreviewOptions {
  document: CadDocument;
  enabled: boolean;
  blank: boolean;
  rolledTo: string | null;
  featureDialog: { kind: 'extrude' | 'pattern' | 'hole'; partId: string } | null;
  partCutting: { id?: string } | null;
  transformDialog: { partId: string; copyId?: string; move?: boolean } | null;
  mirrorDialog: { copyId?: string } | null;
}

/** Every feature dialog shares the same rollback and explicit Final preview behavior. */
export function useFeaturePreview({
  document,
  enabled,
  blank,
  rolledTo,
  featureDialog,
  partCutting,
  transformDialog,
  mirrorDialog,
}: PreviewOptions) {
  const ids = designSteps(document).map(step => step.id);
  const candidate = featureDialog
    ? featureDialog.kind === 'pattern'
      ? document.parts.find(part => part.id === featureDialog.partId)?.pattern?.id
      : `${featureDialog.partId}:extrude`
    : (partCutting?.id ??
      transformDialog?.copyId ??
      (transformDialog?.move ? `${transformDialog.partId}:move` : null) ??
      mirrorDialog?.copyId);
  const editingStep = enabled && candidate && ids.includes(candidate) ? candidate : null;
  const rollbackStep = enabled ? (editingStep ?? (rolledTo && ids.includes(rolledTo) ? rolledTo : null)) : null;
  // Tie Final to the edited step so switching dialogs never renders a later feature with a stale Final toggle.
  const [finalStep, setFinalStep] = useState<string | null>(null);
  const showFinal = !!editingStep && finalStep === editingStep;
  const offersFinal = !!editingStep && ids.at(-1) !== editingStep;
  useEffect(() => setFinalStep(null), [editingStep]);
  useEffect(() => {
    offerFinalPreview(offersFinal ? { shown: showFinal, toggle: () => setFinalStep(showFinal ? null : editingStep) } : null);
    return () => offerFinalPreview(null);
  }, [offersFinal, showFinal, editingStep]);
  const rolledBack = rollbackStep && !(offersFinal && showFinal) ? rollbackStep : null;
  const shownDocument = useMemo(
    () => (blank ? { ...document, parts: [] } : rolledBack ? rolledBackTo(document, rolledBack) : document),
    [document, blank, rolledBack]
  );
  // The steps below the bar the user rolled to: left out of the view, whatever their eye was set to. A feature dialog's
  // own rollback leaves them be: its preview is rolled back, but the sketches after it stay shown to pick from.
  const rolledByUser = editingStep ? null : rolledBack;
  const pastRollback = useMemo<ReadonlySet<string>>(() => {
    const steps = rolledByUser ? designSteps(document).map(step => step.id) : [];
    return new Set(steps.slice(steps.indexOf(rolledByUser!) + 1));
  }, [document, rolledByUser]);
  return { rollbackStep, shownDocument, pastRollback };
}
