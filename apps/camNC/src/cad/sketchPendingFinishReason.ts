import type { ModificationWorkflow } from '@wbcnc/cad-editor/modificationWorkflow';
import type { SketchTool } from './sketchTools';

/** A pending drawing must be completed or cancelled before either sketch confirmation or design Finish. */
export function sketchPendingFinishReason({
  tool,
  selected,
  splitting,
  modification,
  drawing,
}: {
  tool: SketchTool;
  selected: number;
  splitting: boolean;
  modification: ModificationWorkflow;
  drawing: boolean;
}): string | null {
  if (tool === 'slot' && selected) return 'Create the slot or press Escape before finishing the sketch.';
  if ((tool === 'linearPattern' || tool === 'circularPattern') && selected)
    return 'Apply the pattern or press Escape before finishing the sketch.';
  if (tool === 'transform' && selected) return 'Apply the transform or press Escape before finishing the sketch.';
  if (splitting) return 'Choose the second split point or press Escape before finishing the sketch.';
  if ((tool === 'fillet' || tool === 'chamfer') && selected) return 'Apply the corner preview or press Escape before finishing the sketch.';
  if (modification.phase === 'mirror' && modification.entityIds.length)
    return 'Choose the mirror line or press Escape before finishing the sketch.';
  if (modification.phase === 'extend' && modification.entityId)
    return 'Place the extended endpoint or press Escape before finishing the sketch.';
  return drawing ? 'Complete the current shape or press Escape before finishing the sketch.' : null;
}
