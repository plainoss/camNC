import { useMemo } from 'react';
import { Matrix4, type BufferGeometry } from 'three';
import { ModelFaceHighlight } from '@/cam/model/ModelFaceHighlight';
import type { FacePlane } from '@/cam/model/faceHighlight';

/** The per-part mesh is translated back from CAM's normalized stock coordinates. */
export function PartFaceHighlight({ geometry, origin, face }: { geometry: BufferGeometry; origin: [number, number]; face: FacePlane }) {
  const mesh = useMemo(
    () => ({
      positions: Float32Array.from(geometry.getAttribute('position').array),
      indices: geometry.index
        ? Uint32Array.from(geometry.index.array)
        : Uint32Array.from({ length: geometry.getAttribute('position').count }, (_, i) => i),
    }),
    [geometry]
  );
  const matrix = useMemo(() => new Matrix4().makeTranslation(origin[0], origin[1], 0), [origin]);
  const local = useMemo(
    () => ({ ...face, point: [face.point[0] - origin[0], face.point[1] - origin[1], face.point[2]] as [number, number, number] }),
    [face, origin]
  );
  return <ModelFaceHighlight mesh={mesh} matrix={matrix} face={local} selected />;
}
