import { rolledBackTo, type CadDocument } from '@wbcnc/cad';
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
  target: Omit<PartsTarget, 'kind' | 'document' | 'rolledBack'>
): PartsTarget {
  if (!rolledTo) return { kind: 'parts', ...target, document };
  return { kind: 'parts', ...target, document: rolledBackTo(document, rolledTo), rolledBack: true };
}
