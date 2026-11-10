import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, type Matrix4 } from 'three';
import type { BodyMesh } from '../camTypes';
import type { SectionCapRange } from '@/cad/sectionModel';
import { sectionCapMaterial } from './sectionCapMaterial';

/** The pickable solid already contains the cut; this overlay marks its material with hatching. */
export function ModelSectionCap({
  mesh,
  range,
  matrix,
  color = '#b8c0c9',
  opacity = 1,
}: {
  mesh: BodyMesh;
  range: SectionCapRange;
  matrix: Matrix4;
  color?: string;
  opacity?: number;
}) {
  const pixelRatio = useThree(state => state.viewport.dpr);
  const geometry = useMemo(() => {
    const result = new BufferGeometry();
    result.setAttribute('position', new BufferAttribute(mesh.positions, 3));
    result.setIndex(new BufferAttribute(mesh.indices.slice(range.start, range.start + range.count), 1));
    return result;
  }, [mesh, range]);
  const material = useMemo(() => sectionCapMaterial(color, opacity, pixelRatio), [color, opacity, pixelRatio]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  return <mesh geometry={geometry} material={material} matrix={matrix} matrixAutoUpdate={false} raycast={() => {}} />;
}
