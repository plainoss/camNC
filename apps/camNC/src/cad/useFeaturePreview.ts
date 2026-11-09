import type { CadDocument } from '@wbcnc/cad';
import { useEffect, useMemo, useState } from 'react';
import { designSteps, rolledBackTo } from './designSteps';
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
  const shownDocument = useMemo(
    () =>
      blank ? { ...document, parts: [] } : rollbackStep && !(offersFinal && showFinal) ? rolledBackTo(document, rollbackStep) : document,
    [document, blank, rollbackStep, offersFinal, showFinal]
  );
  return { rollbackStep, shownDocument };
}
