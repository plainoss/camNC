import { cadFaceFrame, isCadPart, tessellateCurve, type CadDocument, type CadPoint } from '@wbcnc/cad';

type Vec3 = [number, number, number];

/**
 * The curves of the sketches not yet extruded, where they sit in the model, for the studio to show them as the
 * reference shows a finished sketch: as lines on its plane, until Extrude makes a part of it.
 */
export function sketchLinesInModel(document: CadDocument): { partId: string; points: Vec3[] }[] {
  return document.parts
    .filter(part => !isCadPart(part))
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
