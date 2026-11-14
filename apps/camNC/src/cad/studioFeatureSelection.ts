import { cadPartReference, type CadDocument } from '@wbcnc/cad';
import type { FeatureEntry } from './FeatureList';
import type { StudioDialog } from './studioDialog';

type Step = Extract<FeatureEntry, { kind: 'step' }>['step'];

/**
 * The parts a feature row stands for: every target of a Cut parts step, the one copy a copy's row made or works on,
 * and otherwise the row's whole part family.
 */
export function featureRowParts(document: CadDocument, step: Step): string[] {
  if (step.kind === 'partCut') {
    const cut = document.partCuts?.find(candidate => candidate.id === step.partCutId);
    // The row is listed under its first target, or its first tool when it has none, as its step is.
    if (cut?.targets.length) return [...cut.targets];
    if (cut?.tools.length) return [cut.tools[0]!];
  }
  return [step.copyId !== undefined ? cadPartReference(step.partId, step.copyId) : step.partId];
}

/** A profile picker consumes sketch rows before ordinary feature/physical-part selection changes. */
export function selectStudioFeature(
  document: CadDocument,
  pickSketch: (partId: string) => boolean,
  selection: {
    sketch: (partId: string | null) => void;
    face: () => void;
    /** The row's first part as the physical selection, with every part the row stands for. */
    part: (partId: string, copyId: string | undefined, references: string[]) => void;
    entities: () => void;
  }
) {
  return (entry: FeatureEntry) => {
    const sketch = entry.kind === 'step' && entry.step.kind === 'sketch' ? entry.step.partId : null;
    if (sketch && pickSketch(sketch)) return;
    selection.sketch(sketch);
    selection.face();
    if (entry.kind === 'step') {
      // A saved exact copy must not widen to its source family when its feature row is selected.
      selection.part(entry.step.partId, entry.step.copyId, featureRowParts(document, entry.step));
      selection.entities();
    }
  };
}

/** Whether a feature list row clicked goes to the dialog as its part, as the Linear pattern's feature does. */
export function picksFeatureRows(dialog: StudioDialog | null): boolean {
  return dialog?.kind === 'pattern' && dialog.initialPatternKind === 'linearPattern';
}
