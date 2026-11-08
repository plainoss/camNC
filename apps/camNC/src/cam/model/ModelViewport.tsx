import { Edges, Html, OrbitControls } from '@react-three/drei';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import type { BodyMesh, CamPartInfo } from '../camTypes';
import { modelGeometry } from './modelGeometry';
import { snapToFace } from './faceSnap';
import { centerAssembled, explodeAssembled, layoutFlat } from './layoutFlat';
import { kOrbitDamping } from '@/lib/orbitDamping';

export type ModelView = 'assembled' | 'exploded' | 'flat';

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

const kPlane = '#d08a3c';
const kPlaneHighlight = '#2f80ed';

function Plane({ plane, size, model, onPick }: { plane: ViewPlane; size: number; model: THREE.Matrix4; onPick?: () => void }) {
  const [hovered, setHovered] = useState(false);
  const matrix = useMemo(() => {
    const v = (a: [number, number, number]) => new THREE.Vector3(...a);
    // A square centred on the plane's origin, the size of the model or a little more.
    return model.clone().multiply(new THREE.Matrix4().makeBasis(v(plane.x), v(plane.y), v(plane.normal)).setPosition(v(plane.origin)));
  }, [plane, model]);
  const strong = hovered || plane.highlighted;
  const color = strong ? kPlaneHighlight : kPlane;
  return (
    <mesh
      matrixAutoUpdate={false}
      matrix={matrix}
      renderOrder={1}
      onPointerOver={event => {
        event.stopPropagation();
        if (onPick) setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
      onClick={event => {
        event.stopPropagation();
        if (event.delta <= 4) onPick?.();
      }}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial color={color} transparent opacity={strong ? 0.22 : 0.1} side={THREE.DoubleSide} depthWrite={false} />
      <Edges color={color} />
      <Html
        position={[-size / 2, size / 2, 0]}
        style={{ pointerEvents: 'none', color, font: '11px system-ui, sans-serif', whiteSpace: 'nowrap', userSelect: 'none' }}>
        {plane.label}
      </Html>
    </mesh>
  );
}
/** A face clicked on a part, in the model's own space: its nearest corner or its middle, and the way it faces. */
export interface ModelFacePick {
  partId: string;
  /** Which of the meshes was clicked, for a part shown more than once. */
  index: number;
  point: [number, number, number];
  normal: [number, number, number];
}

const kWood = '#c9a477';
const kSelected = '#8b5cf6';
const kOff = '#71717a';
const kClash = '#dc2626';
function Body({
  mesh,
  matrix,
  color,
  opacity,
  onSelect,
}: {
  mesh: BodyMesh;
  matrix: THREE.Matrix4 | null;
  color: string;
  opacity: number;
  onSelect: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const geometry = useMemo(() => modelGeometry(mesh), [mesh]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh
      geometry={geometry}
      matrixAutoUpdate={false}
      matrix={matrix ?? new THREE.Matrix4()}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        // A drag that ended here was an orbit, not a click.
        if (e.delta <= 4) onSelect(e);
      }}>
      <meshStandardMaterial vertexColors color={color} roughness={0.8} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  );
}

/**
 * Point the camera at the box from the front-right, above (Z up), and orbit around its center. It does so once there's
 * something to see and again when `fitKey` changes, such as on switching to the exploded view, but never because what's
 * shown changed: hiding a part or editing one leaves the camera where it is, as in the reference.
 */
export function FitCamera({ box, fitKey }: { box: THREE.Box3; fitKey?: string }) {
  const camera = useThree(s => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree(s => s.controls) as OrbitControlsImpl | null;
  const aspect = useThree(s => s.size.width / s.size.height);
  const fitted = useRef<{ key?: string; controls: OrbitControlsImpl | null } | null>(null);
  useEffect(() => {
    // Nothing to see yet, or no size to see it at.
    if (box.isEmpty() || !(aspect > 0) || !Number.isFinite(aspect)) return;
    // Fitted already, for this key and with the controls that orbit it.
    if (fitted.current && fitted.current.key === fitKey && fitted.current.controls === controls) return;
    fitted.current = { key: fitKey, controls };
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x / Math.min(aspect, 1.6), size.y, size.z) * 0.62;
    const dist = radius / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    camera.up.set(0, 0, 1);
    camera.position.copy(center).addScaledVector(new THREE.Vector3(0.2, -0.75, 1).normalize(), dist);
    camera.near = dist / 100;
    camera.far = dist * 20;
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.copy(center);
      controls.update();
    }
  }, [box, camera, controls, aspect, fitKey]);
  return null;
}

/** A camera looking straight at a sketch's plane, showing exactly what the sketch's drawing shows, as in a sketch's normal view. */
export interface SketchView {
  /** The sketch's frame in the model: its origin, its x and y, and the way its plane faces (the camera's side). */
  origin: [number, number, number];
  x: [number, number, number];
  y: [number, number, number];
  normal: [number, number, number];
  /** The middle of what's shown, and how wide and high, in the sketch's own mm. */
  center: [number, number];
  width: number;
  height: number;
  /** The view's right, up and toward-the-viewer directions in the sketch's frame, once it's turned off straight on. */
  turned?: { right: [number, number, number]; up: [number, number, number]; back: [number, number, number] };
}

function SketchCamera({ view, model }: { view: SketchView; model: THREE.Matrix4 }) {
  const set = useThree(s => s.set);
  const size = useThree(s => s.size);
  const camera = useMemo(() => new THREE.OrthographicCamera(), []);
  useEffect(() => {
    set({ camera });
  }, [camera, set]);
  useEffect(() => {
    const v = (a: [number, number, number]) => new THREE.Vector3(...a);
    const at = v(view.origin).addScaledVector(v(view.x), view.center[0]).addScaledVector(v(view.y), view.center[1]).applyMatrix4(model);
    // Far enough out along the plane's normal to see everything in front of it, looking back at it.
    const reach = 20000;
    // A direction given in the sketch's frame, in the model's.
    const along = ([a, b, c]: [number, number, number]) =>
      v(view.x).multiplyScalar(a).addScaledVector(v(view.y), b).addScaledVector(v(view.normal), c);
    camera.position.copy(at).addScaledVector(view.turned ? along(view.turned.back) : v(view.normal), reach);
    camera.up.copy(view.turned ? along(view.turned.up) : v(view.y));
    camera.lookAt(at);
    // A face's frame can be mirrored, its x × y facing away from its normal: the picture is mirrored with it, as its
    // drawing is.
    const right = view.turned ? along(view.turned.right) : v(view.x);
    const mirrored = v([1, 0, 0]).applyQuaternion(camera.quaternion).dot(right) < 0;
    camera.left = ((mirrored ? 1 : -1) * view.width) / 2;
    camera.right = ((mirrored ? -1 : 1) * view.width) / 2;
    camera.top = view.height / 2;
    camera.bottom = -view.height / 2;
    camera.near = 1;
    camera.far = reach * 2;
    camera.updateProjectionMatrix();
  }, [camera, view, model, size]);
  return null;
}

function boundsOf(meshes: BodyMesh[], matrices: THREE.Matrix4[]) {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  meshes.forEach((m, i) => {
    for (let k = 0; k < m.positions.length; k += 3) box.expandByPoint(v.fromArray(m.positions, k).applyMatrix4(matrices[i]));
  });
  return box;
}

/**
 * The model in 3D: as designed, pulled apart, or every part laid flat with its machined side up. Click a part to select
 * it, or with `onPickFace`, a face of it.
 */
export function ModelViewport({
  meshes,
  parts,
  view,
  selectedId,
  milled,
  highlightIds = [],
  selectedIndexes,
  warnIds = [],
  onSelect,
  onPickFace,
  onMissed,
  sketchView,
  planes = [],
  onPickPlane,
}: {
  meshes: BodyMesh[];
  parts: CamPartInfo[];
  view: ModelView;
  selectedId: string | null;
  milled: (partId: string) => boolean;
  /** Parts drawn as picked, besides the selected one. */
  highlightIds?: string[];
  /** Draws only these meshes as selected, rather than every mesh of the selected part. */
  selectedIndexes?: number[];
  /** Parts drawn as wrong, such as ones sharing space with another. */
  warnIds?: string[];
  /** A part clicked, with the face of it that was clicked. */
  onSelect: (partId: string, index: number, face?: ModelFacePick) => void;
  onPickFace?: (pick: ModelFacePick) => void;
  onMissed?: () => void;
  /** Looks straight at a sketch's plane, following its drawing, in place of the orbiting camera. */
  sketchView?: SketchView;
  /** Planes to show as designed, such as the base planes a sketch can be drawn on. */
  planes?: ViewPlane[];
  onPickPlane?: (id: string) => void;
}) {
  const flat = useMemo(() => layoutFlat(meshes, parts), [meshes, parts]);
  const assembled = useMemo(() => centerAssembled(meshes), [meshes]);
  const exploded = useMemo(() => explodeAssembled(meshes), [meshes]);
  const matrices = useMemo(
    () => (view === 'flat' ? flat : view === 'exploded' ? exploded : meshes.map(() => assembled)),
    [view, flat, exploded, assembled, meshes]
  );
  // Base planes a little larger than the model, as the reference shows them, and a sensible size before there's one.
  const planeSize = useMemo(() => {
    const size = boundsOf(
      meshes,
      meshes.map(() => assembled)
    ).getSize(new THREE.Vector3());
    return Math.max(100, Math.max(size.x, size.y, size.z) * 0.75);
  }, [meshes, assembled]);
  const shownPlanes = view === 'assembled' ? planes : [];
  const box = useMemo(() => {
    const fit = boundsOf(meshes, matrices);
    if (!shownPlanes.length) return fit;
    // The planes are in view too, so a design with no parts yet still shows them.
    const corner = new THREE.Vector3();
    for (const plane of shownPlanes)
      for (const [a, b] of [
        [-1, -1],
        [1, 1],
      ])
        fit.expandByPoint(
          corner
            .set(...plane.origin)
            .addScaledVector(new THREE.Vector3(...plane.x), (a! * planeSize) / 2)
            .addScaledVector(new THREE.Vector3(...plane.y), (b! * planeSize) / 2)
            .applyMatrix4(assembled)
        );
    return fit;
    // The planes' identity changes with their highlight, which shouldn't move the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meshes, matrices, shownPlanes.length, planeSize, assembled]);
  const pick = (mesh: BodyMesh, index: number, matrix: THREE.Matrix4, e: ThreeEvent<MouseEvent>) => {
    if (!e.face) return onSelect(mesh.partId, index);
    // Back from where the view drew it to where the part sits in the model.
    const point = e.point.clone().applyMatrix4(matrix.clone().invert()),
      normal = e.face.normal.clone().normalize().toArray();
    const face = { partId: mesh.partId, index, point: snapToFace(mesh.positions, point.toArray(), normal), normal };
    if (onPickFace) onPickFace(face);
    else onSelect(mesh.partId, index, face);
  };
  return (
    <Canvas camera={{ fov: 30 }} dpr={[1, 2]} onPointerMissed={() => onMissed?.()}>
      <hemisphereLight args={['#ffffff', '#8a8178', 1.4]} position={[0, 0, 1]} />
      <directionalLight position={[300, -500, 800]} intensity={1.8} />
      <directionalLight position={[-400, 300, 200]} intensity={0.4} />
      {sketchView ? <SketchCamera view={sketchView} model={assembled} /> : <FitCamera box={box} fitKey={view} />}
      <group>
        {meshes.map((m, i) => (
          <Body
            key={i}
            mesh={m}
            matrix={matrices[i]!}
            color={
              (selectedIndexes ? selectedIndexes.includes(i) : m.partId === selectedId) || highlightIds.includes(m.partId)
                ? kSelected
                : warnIds.includes(m.partId)
                  ? kClash
                  : milled(m.partId)
                    ? kWood
                    : kOff
            }
            opacity={milled(m.partId) ? 1 : 0.35}
            onSelect={e => pick(m, i, matrices[i]!, e)}
          />
        ))}
      </group>
      {shownPlanes.map(plane => (
        <Plane key={plane.id} plane={plane} size={planeSize} model={assembled} onPick={onPickPlane && (() => onPickPlane(plane.id))} />
      ))}
      {!sketchView && <OrbitControls makeDefault dampingFactor={kOrbitDamping} />}
    </Canvas>
  );
}
