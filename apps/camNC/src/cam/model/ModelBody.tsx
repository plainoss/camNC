import { Edges } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { BodyMesh } from '../camTypes';
import { modelGeometry } from './modelGeometry';
import { kOrbitSurface } from './orbitPicking';

export function ModelBody({
  mesh,
  matrix,
  color,
  opacity,
  edges,
  onSelect,
  onHover,
}: {
  /** Draws the part's edges over it in a dark line, as a model is shown with its edges. */
  edges?: boolean;
  mesh: BodyMesh;
  matrix: THREE.Matrix4 | null;
  color: string;
  opacity: number;
  onSelect: (e: ThreeEvent<MouseEvent>) => void;
  onHover: (hovered: boolean, event?: ThreeEvent<PointerEvent>) => void;
}) {
  const geometry = useMemo(() => modelGeometry(mesh), [mesh]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh
      geometry={geometry}
      userData={kOrbitSurface}
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
      <meshStandardMaterial
        vertexColors
        color={color}
        roughness={0.8}
        transparent={opacity < 1}
        opacity={opacity}
        depthWrite={opacity >= 1}
      />
      {/* Explicit geometry also invalidates a memoized overlay when the solid changes. */}
      {/* Decorative edges must not intercept corner picks with a line intersection that has no face. */}
      {edges && <Edges geometry={geometry} threshold={20} color="#2b3646" raycast={() => {}} />}
    </mesh>
  );
}
