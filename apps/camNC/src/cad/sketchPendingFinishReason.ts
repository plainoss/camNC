import { t as translate } from '@wbcnc/i18n';
import type { CadSketch } from '@wbcnc/cad';
import type { ModificationWorkflow } from '@wbcnc/cad-editor/modificationWorkflow';
import type { SketchTool } from './sketchTools';

/**
 * A pending drawing must be completed or cancelled before either sketch confirmation or design Finish. A fillet or
 * chamfer whose preview is valid doesn't block: finishing keeps it as shown, as the rounded corner is already drawn.
 */
export function sketchPendingFinishReason({
  tool,
  selected,
  splitting,
  modification,
  drawing,
  cornerReady = false,
}: {
  tool: SketchTool;
  selected: number;
  splitting: boolean;
  modification: ModificationWorkflow;
  drawing: boolean;
  /** The fillet or chamfer preview can be applied as it stands. */
  cornerReady?: boolean;
}): string | null {
  if (tool === 'slot' && selected) return translate('Create the slot or press Escape before finishing the sketch.');
  // A linear pattern being set up is applied as the sketch is confirmed, as it's edited in place.
  if (tool === 'circularPattern' && selected) return translate('Apply the pattern or press Escape before finishing the sketch.');
  if (tool === 'transform' && selected) return translate('Apply the transform or press Escape before finishing the sketch.');
  if (splitting) return translate('Choose the second split point or press Escape before finishing the sketch.');
  if ((tool === 'fillet' || tool === 'chamfer') && selected && !cornerReady)
    return translate('Fix the {{value1}} preview or press Escape before finishing the sketch.', { value1: tool });
  if (modification.phase === 'mirror' && modification.entityIds.length)
    return translate('Choose the mirror line or press Escape before finishing the sketch.');
  if (modification.phase === 'extend' && modification.entityId)
    return translate('Place the extended endpoint or press Escape before finishing the sketch.');
  return drawing ? translate('Complete the current shape or press Escape before finishing the sketch.') : null;
}

/**
 * Why the open sketch can't be finished yet, closed back to the studio or the whole design accepted outside one, or null
 * when it can. A studio sketch finishes unextruded, so points alone, for Hole, are enough there: only Extrude needs a
 * closed outline, and says so itself.
 */
export function openSketchFinishReason(
  sketch: CadSketch | undefined,
  problems: readonly string[],
  state: { checking: boolean; pending: string | null; edgeOnBoard: boolean; thickness: boolean; face: boolean; studio: boolean }
): string | null {
  if (state.checking) return translate('Wait for the current sketch check to finish.');
  if (state.pending || state.edgeOnBoard) return state.pending;
  if (!state.face && !state.thickness) return translate('Enter a valid part thickness before finishing the sketch.');
  if (problems.length) return problems.join(' ');
  // A Part Studio sketch confirms even when it's empty, as the reference's does: a feature using it then fails instead.
  if (state.studio) return null;
  const drawn = !!sketch?.entities.some(e => e.type !== 'point' && !e.construction);
  return state.face || drawn ? null : translate('Draw an outline before finishing the sketch.');
}
