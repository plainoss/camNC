import { designSteps, rolledBackTo, type CadDocument } from '@wbcnc/cad';
import { builtStudioParts } from '../studioParts';
import type { ExportTarget } from './ExportDialog';

type PartsTarget = Extract<ExportTarget, { kind: 'parts' }>;

/**
 * A parts export of what the 3D view shows. With the rollback bar moved, that's the design as it is at the bar, as the
 * view builds it, so the parts and features below the bar are left out of the file too.
 */
export function shownPartsTarget(
  document: CadDocument,
  /** The step the rollback bar sits after, or null at the end. */
  rolledTo: string | null | undefined,
  target: Omit<PartsTarget, 'kind' | 'document' | 'rolledBack' | 'leftOutByRollback'>
): PartsTarget {
  const steps = designSteps(document);
  const at = rolledTo ? steps.findIndex(step => step.id === rolledTo) : -1;
  // A bar at the last step, or at a step the design no longer has, shows the whole design.
  if (at < 0 || at === steps.length - 1) return { kind: 'parts', ...target, document };
  const rolled = rolledBackTo(document, rolledTo!);
  return { kind: 'parts', ...target, document: rolled, rolledBack: true, leftOutByRollback: leftOut(document, rolled, target.only) };
}

/** Whether the bar leaves out what's being exported: the one part or copy, or every part of the design. */
function leftOut(document: CadDocument, rolled: CadDocument, only: PartsTarget['only']): boolean {
  if (!only) return !builtStudioParts(rolled).length && !!builtStudioParts(document).length;
  const before = document.parts.find(part => part.id === only.partId),
    after = rolled.parts.find(part => part.id === only.partId);
  if (!after) return true;
  // Rolled back past its Extrude, a part is only its sketch.
  if (after.extrude === false && before?.extrude !== false) return true;
  return !!only.copyId && !after.copies?.some(copy => copy.id === only.copyId);
}
