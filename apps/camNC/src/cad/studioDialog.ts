import type { CadDocument, CadDrawnOn } from '@wbcnc/cad';
import type { CadHistoryMark } from '@wbcnc/cad-editor/session';
import type { PartPatternKind } from './partPatternKind';
import type { StudioCommand } from './studioCommands';

/** A part's step set in its own dialog, which commits as it is edited. */
export interface StudioFeatureDialog {
  kind: 'extrude' | 'hole' | 'pattern';
  partId: string;
  /** The design and its undo history as the dialog found them, for Cancel to go back to. */
  before: CadHistoryMark;
  initialPatternKind?: PartPatternKind;
}

/**
 * The one step dialog open over the Part Studio's view. Each opening is a new object: previews and split part ids
 * belong to that object, so opening the same step again starts afresh.
 */
export type StudioDialog =
  | StudioFeatureDialog
  /** A part being copied by a transform, the transformed copy being changed, or the part's own move. */
  | { kind: 'transform'; partId: string; copyId?: string; move?: boolean }
  | { kind: 'mirror'; partId: string; copyId?: string }
  | { kind: 'fillet'; partId?: string; filletId?: string }
  | { kind: 'plane'; id?: string; preselected?: CadDrawnOn['on'] }
  /** A variable being added, or the one being changed. */
  | { kind: 'variable'; id?: string }
  /** A "cut parts" step being added, or the one being changed. */
  | { kind: 'partCut'; id?: string };

/** The toolbar command each dialog belongs to, which shows as active while it is open. */
export const dialogCommand: Record<StudioDialog['kind'], StudioCommand> = {
  extrude: 'extrude',
  hole: 'hole',
  pattern: 'pattern',
  transform: 'transform',
  mirror: 'mirror',
  fillet: 'fillet',
  plane: 'plane',
  variable: 'variable',
  partCut: 'cutParts',
};

export function featureDialog(dialog: StudioDialog | null): StudioFeatureDialog | null {
  return dialog && (dialog.kind === 'extrude' || dialog.kind === 'hole' || dialog.kind === 'pattern') ? dialog : null;
}

/** Whether a part clicked in the view or the Parts list goes to the dialog rather than the selection. */
export function picksParts(dialog: StudioDialog | null): boolean {
  return !!dialog && (dialog.kind === 'partCut' || dialog.kind === 'mirror' || dialog.kind === 'transform' || dialog.kind === 'pattern');
}

/**
 * The dialog whose candidate shows in the view before it is accepted. Extrude and Hole have none: they commit each
 * edit, so the view shows the design itself.
 */
export function previewOwner(dialog: StudioDialog | null): StudioDialog | null {
  return dialog && dialog.kind !== 'extrude' && dialog.kind !== 'hole' ? dialog : null;
}

/** The design step a dialog edits, which the view rolls back to. A dialog adding a step, or setting none, has no step. */
export function editedStepId(document: CadDocument, dialog: StudioDialog | null): string | null {
  switch (dialog?.kind) {
    case 'extrude':
    case 'hole':
      return `${dialog.partId}:extrude`;
    case 'pattern':
      return document.parts.find(part => part.id === dialog.partId)?.pattern?.id ?? null;
    case 'partCut':
      return dialog.id ?? null;
    case 'transform':
      return dialog.copyId ?? (dialog.move ? `${dialog.partId}:move` : null);
    case 'mirror':
      return dialog.copyId ?? null;
    default:
      return null;
  }
}
