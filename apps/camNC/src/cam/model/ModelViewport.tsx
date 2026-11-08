import { OrbitControls } from '@react-three/drei';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import type { BodyMesh, CamPartInfo } from '../camTypes';
import { modelGeometry } from './modelGeometry';
import { snapToFace } from './faceSnap';
import { centerAssembled, explodeAssembled, layoutFlat } from './layoutFlat';
import { kOrbitDamping } from '@/lib/orbitDamping';

export type ModelView = 'assembled' | 'exploded' | 'flat';
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

/** Point the camera at the box from the front-right, above (Z up), and orbit around its center. */
export function FitCamera({ box }: { box: THREE.Box3 }) {
  const camera = useThree(s => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree(s => s.controls) as OrbitControlsImpl | null;
  const aspect = useThree(s => s.size.width / s.size.height);
  useEffect(() => {
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
  }, [box, camera, controls, aspect]);
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
  onSelect: (partId: string, index: number) => void;
  onPickFace?: (pick: ModelFacePick) => void;
  onMissed?: () => void;
  /** Looks straight at a sketch's plane, following its drawing, in place of the orbiting camera. */
  sketchView?: SketchView;
}) {
  const flat = useMemo(() => layoutFlat(meshes, parts), [meshes, parts]);
  const assembled = useMemo(() => centerAssembled(meshes), [meshes]);
  const exploded = useMemo(() => explodeAssembled(meshes), [meshes]);
  const matrices = useMemo(
    () => (view === 'flat' ? flat : view === 'exploded' ? exploded : meshes.map(() => assembled)),
    [view, flat, exploded, assembled, meshes]
  );
  const box = useMemo(() => boundsOf(meshes, matrices), [meshes, matrices]);
  const pick = (mesh: BodyMesh, index: number, matrix: THREE.Matrix4, e: ThreeEvent<MouseEvent>) => {
    if (!onPickFace || !e.face) return onSelect(mesh.partId, index);
    // Back from where the view drew it to where the part sits in the model.
    const point = e.point.clone().applyMatrix4(matrix.clone().invert()),
      normal = e.face.normal.clone().normalize().toArray();
    onPickFace({ partId: mesh.partId, index, point: snapToFace(mesh.positions, point.toArray(), normal), normal });
  };
  return (
    <Canvas camera={{ fov: 30 }} dpr={[1, 2]} onPointerMissed={() => onMissed?.()}>
      <hemisphereLight args={['#ffffff', '#8a8178', 1.4]} position={[0, 0, 1]} />
      <directionalLight position={[300, -500, 800]} intensity={1.8} />
      <directionalLight position={[-400, 300, 200]} intensity={0.4} />
      {sketchView ? <SketchCamera view={sketchView} model={assembled} /> : <FitCamera box={box} />}
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
      {!sketchView && <OrbitControls makeDefault dampingFactor={kOrbitDamping} />}
    </Canvas>
  );
}
