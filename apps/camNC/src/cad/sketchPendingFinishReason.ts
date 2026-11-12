import type { CadSketch } from '@wbcnc/cad';
import { isEmptySketch } from '@wbcnc/cad-editor/sketchFeedback';
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
  if (tool === 'slot' && selected) return 'Create the slot or press Escape before finishing the sketch.';
  if ((tool === 'linearPattern' || tool === 'circularPattern') && selected)
    return 'Apply the pattern or press Escape before finishing the sketch.';
  if (tool === 'transform' && selected) return 'Apply the transform or press Escape before finishing the sketch.';
  if (splitting) return 'Choose the second split point or press Escape before finishing the sketch.';
  if ((tool === 'fillet' || tool === 'chamfer') && selected && !cornerReady)
    return `Fix the ${tool} preview or press Escape before finishing the sketch.`;
  if (modification.phase === 'mirror' && modification.entityIds.length)
    return 'Choose the mirror line or press Escape before finishing the sketch.';
  if (modification.phase === 'extend' && modification.entityId)
    return 'Place the extended endpoint or press Escape before finishing the sketch.';
  return drawing ? 'Complete the current shape or press Escape before finishing the sketch.' : null;
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
  if (state.checking) return 'Wait for the current sketch check to finish.';
  if (state.pending || state.edgeOnBoard) return state.pending;
  if (!state.face && !state.thickness) return 'Enter a valid part thickness before finishing the sketch.';
  if (problems.length) return problems.join(' ');
  const drawn = state.studio ? !isEmptySketch(sketch) : !!sketch?.entities.some(e => e.type !== 'point' && !e.construction);
  return state.face || drawn ? null : 'Draw an outline before finishing the sketch.';
}
