import { idleModificationWorkflow } from '@wbcnc/cad-editor/modificationWorkflow';
import { expect, it } from 'vitest';
import { sketchPendingFinishReason } from './sketchPendingFinishReason';

it('lets a sketch finish with a fillet or chamfer previewed that can be applied, and not with one that can’t', () => {
  const state = { selected: 1, splitting: false, modification: idleModificationWorkflow(), drawing: false };
  for (const tool of ['fillet', 'chamfer'] as const) {
    expect(sketchPendingFinishReason({ ...state, tool, cornerReady: true })).toBeNull();
    expect(sketchPendingFinishReason({ ...state, tool })).toBe(`Fix the ${tool} preview or press Escape before finishing the sketch.`);
  }
});
