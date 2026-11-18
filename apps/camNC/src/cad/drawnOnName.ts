import { cadPartReference, cadPartReferenceName, designStepLabel, designSteps, type CadDocument, type CadDrawnOn } from '@wbcnc/cad';
import { isBlank } from './editorHelpers';
import type { StudioDialog } from './studioDialog';

const kPlaneNames = { top: 'the top plane', front: 'the front plane', right: 'the right plane' } as const;

/** What a part is drawn on, said the way a person would. */
export function drawnOnName(document: CadDocument, on: CadDrawnOn['on']): string {
  if ('plane' in on) return kPlaneNames[on.plane];
  const support = cadPartReferenceName(document, cadPartReference(on.partId, on.copyId)) ?? 'a removed part';
  return on.face === 'top' ? `the top of ${support}` : on.face === 'underside' ? `the underside of ${support}` : `an edge of ${support}`;
}

/** The Sketch dialog's plane field: a plane by its name, or a face named for the feature that made it, as Face of Extrude 1. */
export function sketchPlaneName(document: CadDocument, drawnOn: CadDrawnOn | undefined): string {
  if (!drawnOn) return 'Top plane';
  const { on, datum } = drawnOn;
  const plane = datum && document.planes?.find(candidate => candidate.id === datum)?.name;
  if (plane) return plane;
  if ('plane' in on) return `${on.plane[0]!.toUpperCase()}${on.plane.slice(1)} plane`;
  // A copy's face is told apart from the part's own by the copy's name.
  if (on.copyId) return drawnOnName(document, on);
  const part = document.parts.find(candidate => candidate.id === on.partId);
  const made = designStepLabel(document, `${part?.extrudedWith ?? on.partId}:extrude`);
  return made ? `Face of ${made}` : drawnOnName(document, on);
}

/**
 * The name the next sketch takes: numbered after the sketches above where it goes, the rollback bar or the end. The
 * blank part a new design opens with is the one it reuses.
 */
export function nextSketchLabel(document: CadDocument, rolledTo?: string | null): string {
  if (document.parts.length === 1 && isBlank(document.parts[0]!)) return 'Sketch 1';
  const steps = designSteps(document);
  const at = rolledTo ? steps.findIndex(step => step.id === rolledTo) : -1;
  return `Sketch ${(at < 0 ? steps : steps.slice(0, at + 1)).filter(step => step.kind === 'sketch').length + 1}`;
}

/** The name a new Fillet takes, numbered after every fillet in the design, as Fillet 2. */
export function nextFilletLabel(document: CadDocument): string {
  return `Fillet ${designSteps(document).filter(step => step.kind === 'fillet').length + 1}`;
}

/** The row of a feature whose dialog is open before it's made: a sketch waiting for its plane, or a new Fillet. */
export function pendingRow(document: CadDocument, dialog: StudioDialog | null, choosingPlane: boolean, rolledTo: string | null) {
  if (choosingPlane) return { kind: 'sketch' as const, label: nextSketchLabel(document, rolledTo) };
  if (dialog?.kind === 'fillet' && !dialog.filletId) return { kind: 'fillet' as const, label: nextFilletLabel(document) };
  if (dialog?.kind === 'transform' && !dialog.copyId && !dialog.move) {
    const made = designSteps(document).filter(step => step.label.startsWith('Transform')).length;
    return { kind: 'copy' as const, label: `Transform ${made + 1}` };
  }
  return undefined;
}
