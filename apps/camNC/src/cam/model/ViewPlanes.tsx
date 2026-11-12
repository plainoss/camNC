import { Edges, Html } from '@react-three/drei';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { kPlaneMarker, planeGivesWay } from './planePicking';
import { kOrbitSurface } from './orbitPicking';

/** A plane shown in the view to draw on, as a translucent square with its name at a corner. */
export interface ViewPlane {
  id: string;
  label: string;
  origin: [number, number, number];
  x: [number, number, number];
  y: [number, number, number];
  normal: [number, number, number];
  /** Drawn stronger, as when it's picked or its row in the feature list is. */
  highlighted?: boolean;
}

/** A region of a sketch shown to be picked for an extrude, on the sketch's plane. */
export interface ViewRegion {
  id: string;
  /** The sketch's plane: points of the region are in its x and y. */
  frame: { origin: [number, number, number]; x: [number, number, number]; y: [number, number, number]; normal: [number, number, number] };
  outline: { x: number; y: number }[];
  holes: { x: number; y: number }[][];
  picked: boolean;
}

export function Region({ region, model, onPick }: { region: ViewRegion; model: THREE.Matrix4; onPick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const geometry = useMemo(() => {
    const shape = new THREE.Shape(region.outline.map(p => new THREE.Vector2(p.x, p.y)));
    shape.holes = region.holes.map(hole => new THREE.Path(hole.map(p => new THREE.Vector2(p.x, p.y))));
    return new THREE.ShapeGeometry(shape);
  }, [region]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const matrix = useMemo(() => {
    const v = (a: [number, number, number]) => new THREE.Vector3(...a);
    const { frame } = region;
    return model.clone().multiply(new THREE.Matrix4().makeBasis(v(frame.x), v(frame.y), v(frame.normal)).setPosition(v(frame.origin)));
  }, [region, model]);
  return (
    <mesh
      geometry={geometry}
      userData={kOrbitSurface}
      matrixAutoUpdate={false}
      matrix={matrix}
      renderOrder={2}
      onPointerOver={event => {
        event.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
      onClick={event => {
        event.stopPropagation();
        if (event.delta <= 4) onPick();
      }}>
      <meshBasicMaterial
        color={region.picked ? '#2f80ed' : '#1f6fc5'}
        transparent
        opacity={region.picked ? 0.45 : hovered ? 0.3 : 0.12}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

// Planes are a pale blue, and turn orange when hovered or picked.
export const kPlane = '#7aa6d8';
const kPlaneHighlight = '#f0a020';

export function Plane({ plane, size, model, onPick }: { plane: ViewPlane; size: number; model: THREE.Matrix4; onPick?: () => void }) {
  const [hovered, setHovered] = useState(false);
  const matrix = useMemo(() => {
    const v = (a: [number, number, number]) => new THREE.Vector3(...a);
    // A square centred on the plane's origin, the size of the model or a little more.
    return model.clone().multiply(new THREE.Matrix4().makeBasis(v(plane.x), v(plane.y), v(plane.normal)).setPosition(v(plane.origin)));
  }, [plane, model]);
  // Hovered, only the outline lights up; picked, the whole plane does.
  const color = plane.highlighted ? kPlaneHighlight : kPlane;
  return (
    <mesh
      matrixAutoUpdate={false}
      matrix={matrix}
      renderOrder={1}
      userData={{ ...kPlaneMarker, ...kOrbitSurface }}
      onPointerOver={event => {
        if (planeGivesWay(event.intersections)) return;
        event.stopPropagation();
        if (onPick) setHovered(true);
      }}
      onPointerMove={event => {
        // A face or region under the pointer, even behind the plane, is what's hovered.
        if (planeGivesWay(event.intersections)) return setHovered(false);
        event.stopPropagation();
        if (onPick) setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
      onClick={event => {
        if (planeGivesWay(event.intersections)) return;
        event.stopPropagation();
        if (event.delta <= 4) onPick?.();
      }}>
      <planeGeometry args={[size, size]} />
      {/* Pushed back in depth, so a part's face lying on the plane covers it evenly instead of flickering through. */}
      <meshBasicMaterial
        color={color}
        transparent
        opacity={plane.highlighted ? 0.2 : 0.07}
        side={THREE.DoubleSide}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={2}
        polygonOffsetUnits={2}
      />
      <Edges key={size} color={hovered ? kPlaneHighlight : color} />
      <Html
        // Under the dialogs and panels over the view, not on top of everything.
        zIndexRange={[5, 0]}
        position={[-size / 2, size / 2, 0]}
        style={{ pointerEvents: 'none', color, font: '11px system-ui, sans-serif', whiteSpace: 'nowrap', userSelect: 'none' }}>
        {plane.label}
      </Html>
    </mesh>
  );
}
