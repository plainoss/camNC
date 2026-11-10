import { useEffect, useMemo } from 'react';
import type { Matrix4 } from 'three';
import type { BodyMesh } from '../camTypes';
import { faceHighlightGeometry, type FacePlane } from './faceHighlight';

/** Non-interactive overlay: the actual solid remains responsible for all pointer hit testing. */
export function ModelFaceHighlight({
  mesh,
  matrix,
  face,
  selected,
}: {
  mesh: Pick<BodyMesh, 'positions' | 'indices'>;
  matrix: Matrix4;
  face: FacePlane;
  selected: boolean;
}) {
  const geometry = useMemo(() => faceHighlightGeometry(mesh, face), [mesh, face]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} matrix={matrix} matrixAutoUpdate={false} raycast={() => {}}>
      <meshBasicMaterial
        color={selected ? '#f0a020' : '#4c9aee'}
        transparent
        opacity={selected ? 0.55 : 0.3}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
      />
    </mesh>
  );
}
