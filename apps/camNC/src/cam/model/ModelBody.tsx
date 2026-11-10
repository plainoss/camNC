import { Edges } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { BodyMesh } from '../camTypes';
import { modelGeometry } from './modelGeometry';
import { kOrbitSurface } from './orbitPicking';
import type { SectionCapRange } from '@/cad/sectionModel';

export function ModelBody({
  mesh,
  matrix,
  color,
  opacity,
  edges,
  sectionCap,
  onSelect,
  onHover,
}: {
  /** Draws the part's edges over it in a dark line, as a model is shown with its edges. */
  edges?: boolean;
  /** Keep cut triangles pickable while the separate hatch material renders their color exactly once. */
  sectionCap?: SectionCapRange | null;
  mesh: BodyMesh;
  matrix: THREE.Matrix4 | null;
  color: string;
  opacity: number;
  onSelect: (e: ThreeEvent<MouseEvent>) => void;
  onHover: (hovered: boolean, event?: ThreeEvent<PointerEvent>) => void;
}) {
  const geometry = useMemo(() => {
    const geometry = modelGeometry(mesh);
    if (sectionCap) {
      const total = geometry.index?.count ?? geometry.getAttribute('position').count;
      const end = sectionCap.start + sectionCap.count;
      geometry.clearGroups();
      if (sectionCap.start > 0) geometry.addGroup(0, sectionCap.start, 0);
      geometry.addGroup(sectionCap.start, sectionCap.count, 1);
      if (end < total) geometry.addGroup(end, total - end, 0);
    }
    return geometry;
  }, [mesh, sectionCap]);
  const hasSectionCap = !!sectionCap;
  const materials = useMemo(() => {
    const body = new THREE.MeshStandardMaterial({
      vertexColors: true,
      color,
      roughness: 0.8,
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity >= 1,
    });
    // Material visibility affects rendering, while Mesh.raycast still tests the group's finite triangles.
    const cap = hasSectionCap ? new THREE.MeshBasicMaterial({ visible: false }) : null;
    return { body, cap, render: cap ? [body, cap] : body };
  }, [color, opacity, hasSectionCap]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(
    () => () => {
      materials.body.dispose();
      materials.cap?.dispose();
    },
    [materials]
  );
  return (
    <mesh
      geometry={geometry}
      userData={kOrbitSurface}
      material={materials.render}
      matrixAutoUpdate={false}
      matrix={matrix ?? new THREE.Matrix4()}
      onPointerOver={event => {
        event.stopPropagation();
        onHover(true, event);
      }}
      onPointerMove={event => {
        event.stopPropagation();
        onHover(true, event);
      }}
      onPointerOut={() => onHover(false)}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        // A drag that ended here was an orbit, not a click.
        if (e.delta <= 4) onSelect(e);
      }}>
      {/* Recreate the instanced lines with the solid: Three caches their first GPU draw count, truncating added edges. */}
      {/* Decorative edges must not intercept corner picks with a line intersection that has no face. */}
      {edges && <Edges key={geometry.uuid} geometry={geometry} threshold={20} color="#2b3646" raycast={() => {}} />}
    </mesh>
  );
}
