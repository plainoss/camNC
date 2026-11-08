import { reconcileSlot, slotSketchEntities, type CadSlot, type CadSketch } from '@wbcnc/cad';
import { parseCadValue } from './valueExpressions';
export function previewSlot(
  sketch: CadSketch,
  entityIds: readonly string[],
  text: string,
  includeConnected: boolean,
  sharedWidthEntityId?: string
) {
  const parsed = parseCadValue(text, { unit: 'mm' });
  if ('error' in parsed) return { ok: false as const, message: parsed.error };
  let source = sketch;
  if (sharedWidthEntityId) {
    source = {
      ...sketch,
      constraints: sketch.constraints.map(c =>
        c.type === 'diameter' && c.entityId === sharedWidthEntityId ? { ...c, value: parsed.value, expression: undefined } : c
      ),
    };
    for (const slot of source.constraints.filter((c): c is CadSlot => c.type === 'slot' && c.widthEntityId === sharedWidthEntityId)) {
      const result = reconcileSlot(source, slot);
      if (!result.ok) return result;
      source = result.sketch;
    }
  }
  return slotSketchEntities(source, { entityIds, width: parsed.value, includeConnected, sharedWidthEntityId });
}
