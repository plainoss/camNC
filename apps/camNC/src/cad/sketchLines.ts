import { cadFaceFrame, tessellateCurve, type CadDocument, type CadPoint } from '@wbcnc/cad';
import { sketchesShownByDefault } from './sketchShown';

type Vec3 = [number, number, number];

/**
 * The curves of the sketches shown, where they sit in the model, as lines on their planes. By default those no built
 * Extrude uses (see `sketchesShownByDefault`); a hidden sketch can be shown again from the feature list.
 */
export function sketchLinesInModel(
  document: CadDocument,
  shown: (partId: string) => boolean = partId => sketchesShownByDefault(document).has(partId)
): { partId: string; points: Vec3[] }[] {
  return document.parts
    .filter(part => !part.sketchOf && !part.faceProfile && shown(part.id))
    .flatMap(part => {
      const frame = cadFaceFrame(document, part.drawnOn?.on ?? { plane: 'top' });
      if ('error' in frame) return [];
      const offset = part.drawnOn?.offset ?? 0;
      const at = ({ x, y }: CadPoint): Vec3 =>
        [0, 1, 2].map(axis => frame.origin[axis]! + frame.normal[axis]! * offset + frame.x[axis]! * x + frame.y[axis]! * y) as Vec3;
      const points = new Map(part.sketch.entities.flatMap(entity => (entity.type === 'point' ? [[entity.id, entity] as const] : [])));
      return part.sketch.entities.flatMap(entity => {
        if (entity.type === 'point' || entity.construction || entity.faceEdge) return [];
        try {
          return [{ partId: part.id, points: tessellateCurve(entity, points).map(at) }];
        } catch {
          return [];
        }
      });
    });
}
