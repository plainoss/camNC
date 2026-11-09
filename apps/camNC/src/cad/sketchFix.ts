import { originId, type CadSketch } from '@wbcnc/cad';
import { entityPointIds } from './editorHelpers';

/**
 * Fixes the points of `targets` (points, or curves by their points), or unfixes them when they are all fixed already.
 * The origin and a face's edges always stay fixed. `tool` words the message for the Fix tool, which stays on.
 */
export function toggleFixed(sketch: CadSketch, targets: string[], tool: boolean): { sketch?: CadSketch; message: string } {
  const ids = new Set(
    targets.flatMap(id => {
      const entity = sketch.entities.find(e => e.id === id);
      return entity ? entityPointIds(entity) : [];
    })
  );
  ids.delete(originId(sketch));
  for (const e of sketch.entities) if (e.faceEdge) ids.delete(e.id);
  if (!ids.size) return { message: 'Select geometry to fix. The origin and the edges of the face it’s drawn on always stay fixed.' };
  const fix = sketch.entities.some(e => e.type === 'point' && ids.has(e.id) && !e.fixed);
  return {
    sketch: { ...sketch, entities: sketch.entities.map(e => (e.type === 'point' && ids.has(e.id) ? { ...e, fixed: fix } : e)) },
    message: tool
      ? `${fix ? 'Fixed' : 'Unfixed'}. Click more geometry, or press Escape to end Fix.`
      : fix
        ? 'Selected geometry fixed. Shift+J unfixes it.'
        : 'Selected geometry unfixed.',
  };
}
