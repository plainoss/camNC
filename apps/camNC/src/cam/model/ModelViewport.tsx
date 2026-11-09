import { Edges, Html, Line, OrbitControls } from '@react-three/drei';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { kPlaneMarker, planeGivesWay } from './planePicking';
import type { BodyMesh, CamPartInfo } from '../camTypes';
import { ViewCube } from './ViewCube';
import { modelGeometry } from './modelGeometry';
import { snapToFace } from './faceSnap';
import { centerAssembled, explodeAssembled, layoutFlat } from './layoutFlat';
import { kCadMouseButtons, kOrbitDamping } from '@/lib/orbitDamping';

export type ModelView = 'assembled' | 'exploded' | 'flat';
export interface ViewRequest {
  name: 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso' | 'fit' | 'normal';
  seq: number;
  /** For `normal`: the way the camera looks from, out of a plane or face, and which way is up on it. For a cube edge or corner: the way it looks from, with Z up. */
  direction?: [number, number, number];
  up?: [number, number, number];
}

const kViewDirections = {
  front: [0, -1, 0],
  back: [0, 1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  iso: [0.2, -0.75, 1],
} satisfies Record<Exclude<ViewRequest['name'], 'fit' | 'normal'>, [number, number, number]>;

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

function Region({ region, model, onPick }: { region: ViewRegion; model: THREE.Matrix4; onPick: () => void }) {
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
const kPlane = '#7aa6d8';
/** A finished sketch's curve in the model, by the sketch's part. */
export interface SketchLine {
  partId: string;
  points: [number, number, number][];
}
const kNoLines: SketchLine[] = [];
const kPlaneHighlight = '#f0a020';

function Plane({ plane, size, model, onPick }: { plane: ViewPlane; size: number; model: THREE.Matrix4; onPick?: () => void }) {
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
      userData={kPlaneMarker}
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
      <Edges color={hovered ? kPlaneHighlight : color} />
      {/* Below the studio's dialogs (z-index 6), which the view's labels would otherwise draw over. */}
      <Html
        position={[-size / 2, size / 2, 0]}
        zIndexRange={[5, 0]}
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
// The studio's parts, as the reference shows them: a neutral grey, picked in orange, with no colour for overlaps.
const kStudioPart = '#b8c0c9';
const kStudioPicked = '#f39c2c';
function Body({
  mesh,
  matrix,
  color,
  opacity,
  onSelect,
  onHover,
}: {
  mesh: BodyMesh;
  matrix: THREE.Matrix4 | null;
  color: string;
  opacity: number;
  onSelect: (e: ThreeEvent<MouseEvent>) => void;
  onHover: (hovered: boolean) => void;
}) {
  const geometry = useMemo(() => modelGeometry(mesh), [mesh]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh
      geometry={geometry}
      matrixAutoUpdate={false}
      matrix={matrix ?? new THREE.Matrix4()}
      onPointerOver={event => {
        event.stopPropagation();
        onHover(true);
      }}
      onPointerMove={event => {
        event.stopPropagation();
        onHover(true);
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
    </mesh>
  );
}

/**
 * Point the camera at the box from the front-right, above (Z up), and orbit around its center. It does so once there's
 * something to see and again when `fitKey` changes, such as on switching to the exploded view, but never because what's
 * shown changed: hiding a part or editing one leaves the camera where it is. Explicit view requests also refit it.
 */
export function FitCamera({ box, fitKey, viewRequest }: { box: THREE.Box3; fitKey?: string; viewRequest?: ViewRequest }) {
  const camera = useThree(s => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree(s => s.controls) as OrbitControlsImpl | null;
  const aspect = useThree(s => s.size.width / s.size.height);
  const invalidate = useThree(s => s.invalidate);
  const fitted = useRef<{ key?: string; seq?: number; controls: OrbitControlsImpl | null } | null>(null);
  useEffect(() => {
    // Nothing to see yet, or no size to see it at.
    if (box.isEmpty() || !(aspect > 0) || !Number.isFinite(aspect)) return;
    // Fitted already, for this key and with the controls that orbit it.
    if (fitted.current && fitted.current.key === fitKey && fitted.current.controls === controls && fitted.current.seq === viewRequest?.seq)
      return;
    fitted.current = { key: fitKey, controls, seq: viewRequest?.seq };
    if (controls?.enableDamping) {
      // Finish any orbit or pan still easing out, so it doesn't carry on from the view placed here.
      controls.enableDamping = false;
      controls.update();
      controls.enableDamping = true;
    }
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x / Math.min(aspect, 1.6), size.y, size.z) * 0.62;
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    let dist = radius / tan;
    const name = viewRequest?.name ?? 'iso';
    const direction =
      name === 'fit'
        ? camera.getWorldDirection(new THREE.Vector3()).negate()
        : name === 'normal' || viewRequest?.direction
          ? new THREE.Vector3(...(viewRequest?.direction ?? [0, 0, 1])).normalize()
          : new THREE.Vector3(...kViewDirections[name]).normalize();
    if (name === 'normal') camera.up.set(...(viewRequest?.up ?? [0, 1, 0]));
    else if (name !== 'fit') {
      const vertical = Math.abs(direction.z) > 1 - 1e-10;
      camera.up.set(0, vertical ? 1 : 0, vertical ? 0 : 1);
    }
    if (viewRequest) {
      // Fit every corner in the requested camera frame, including its depth toward the camera.
      const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize();
      const up = new THREE.Vector3().crossVectors(direction, right);
      dist = 0;
      for (const x of [box.min.x, box.max.x])
        for (const y of [box.min.y, box.max.y])
          for (const z of [box.min.z, box.max.z]) {
            const corner = new THREE.Vector3(x, y, z).sub(center);
            dist = Math.max(
              dist,
              corner.dot(direction) + Math.max(Math.abs(corner.dot(right)) / (tan * aspect), Math.abs(corner.dot(up)) / tan)
            );
          }
      dist = Math.max(dist * 1.1, 1);
    }
    camera.position.copy(center).addScaledVector(direction, dist);
    camera.near = dist / 100;
    camera.far = dist * 20;
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.copy(center);
      controls.update();
    }
    // The view draws only when something changes, and moving the camera is a change.
    invalidate();
  }, [box, camera, controls, aspect, fitKey, viewRequest, invalidate]);
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
  const invalidate = useThree(s => s.invalidate);
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
    invalidate();
  }, [camera, view, model, size, invalidate]);
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
  onHover,
  sketchView,
  viewRequest,
  onViewRequest,
  transparentIds,
  instanceIds,
  planes = [],
  onPickPlane,
  sketchLines = kNoLines,
  showOrigin = false,
  palette,
  regions = [],
  onPickRegion,
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
  /** The part under the pointer, with its mesh index to distinguish copies. */
  onHover?: (id: string | null, index?: number) => void;
  /** Looks straight at a sketch's plane, following its drawing, in place of the orbiting camera. */
  sketchView?: SketchView;
  viewRequest?: ViewRequest;
  /** Supplied by the studio, which owns all camera requests. */
  onViewRequest?: (request: Omit<ViewRequest, 'seq'>) => void;
  transparentIds?: ReadonlySet<string>;
  /** Instance keys distinguish copies that share a part ID. */
  instanceIds?: string[];
  /** Planes to show as designed, such as the base planes a sketch can be drawn on. */
  planes?: ViewPlane[];
  onPickPlane?: (id: string) => void;
  /** Finished sketches not yet extruded, as polylines in the model, shown on their planes. */
  sketchLines?: SketchLine[];
  /** The design's origin, as a point where the base planes meet. */
  showOrigin?: boolean;
  /** `studio` shows parts as the reference does: grey, picked in orange. */
  palette?: 'studio';
  /** A sketch's regions to pick for an extrude, and picking one. */
  regions?: ViewRegion[];
  onPickRegion?: (id: string) => void;
}) {
  const flat = useMemo(() => layoutFlat(meshes, parts), [meshes, parts]);
  // The studio shows a design where it is, about its origin, so hiding a part doesn't shift the rest.
  const assembled = useMemo(() => (palette === 'studio' ? new THREE.Matrix4() : centerAssembled(meshes)), [meshes, palette]);
  const exploded = useMemo(() => explodeAssembled(meshes), [meshes]);
  const matrices = useMemo(
    () => (view === 'flat' ? flat : view === 'exploded' ? exploded : meshes.map(() => assembled)),
    [view, flat, exploded, assembled, meshes]
  );
  // Base planes centred on the origin and big enough to take in the whole model, as the reference sizes them, so a
  // part drawn away from the origin still sits on its plane. A sensible size before there's anything.
  const planeSize = useMemo(() => {
    const reach = boundsOf(
      meshes,
      meshes.map(() => new THREE.Matrix4())
    );
    for (const line of sketchLines) for (const point of line.points) reach.expandByPoint(new THREE.Vector3(...point));
    if (reach.isEmpty()) return 100;
    const half = Math.max(...reach.min.toArray().map(Math.abs), ...reach.max.toArray().map(Math.abs));
    return Math.max(100, half * 2.2);
  }, [meshes, sketchLines]);
  const shownPlanes = view === 'assembled' ? planes : [];
  const box = useMemo(() => {
    const fit = boundsOf(meshes, matrices);
    // Finished sketches are in view too, as a first one is before it has any part.
    for (const line of view === 'assembled' ? sketchLines : [])
      for (const point of line.points) fit.expandByPoint(new THREE.Vector3(...point).applyMatrix4(assembled));
    // So are the regions to pick for an extrude, as when the sketch can't be a part as a whole.
    for (const region of view === 'assembled' ? regions : [])
      for (const point of region.outline)
        fit.expandByPoint(
          new THREE.Vector3(...region.frame.origin)
            .addScaledVector(new THREE.Vector3(...region.frame.x), point.x)
            .addScaledVector(new THREE.Vector3(...region.frame.y), point.y)
            .applyMatrix4(assembled)
        );
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
  }, [meshes, matrices, shownPlanes.length, planeSize, assembled, sketchLines, regions, view]);
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
    <Canvas
      // Drawn when something changes, not every frame, so an idle view costs nothing.
      frameloop="demand"
      camera={{ fov: 30 }}
      dpr={[1, 2]}
      onPointerLeave={() => onHover?.(null)}
      onPointerMissed={() => {
        onHover?.(null);
        onMissed?.();
      }}>
      <hemisphereLight args={['#ffffff', '#8a8178', 1.4]} position={[0, 0, 1]} />
      <directionalLight position={[300, -500, 800]} intensity={1.8} />
      <directionalLight position={[-400, 300, 200]} intensity={0.4} />
      {sketchView ? <SketchCamera view={sketchView} model={assembled} /> : <FitCamera box={box} fitKey={view} viewRequest={viewRequest} />}
      <group>
        {meshes.map((m, i) => (
          <Body
            key={i}
            mesh={m}
            matrix={matrices[i]!}
            color={
              (selectedIndexes ? selectedIndexes.includes(i) : m.partId === selectedId) || highlightIds.includes(m.partId)
                ? palette === 'studio'
                  ? kStudioPicked
                  : kSelected
                : warnIds.includes(m.partId)
                  ? kClash
                  : !milled(m.partId)
                    ? kOff
                    : palette === 'studio'
                      ? kStudioPart
                      : kWood
            }
            opacity={transparentIds?.has(instanceIds?.[i] ?? m.partId) ? 0.3 : milled(m.partId) ? 1 : 0.35}
            onSelect={e => pick(m, i, matrices[i]!, e)}
            onHover={hovered => onHover?.(hovered ? m.partId : null, hovered ? i : undefined)}
          />
        ))}
      </group>
      {view === 'assembled' && sketchLines.length > 0 && (
        <group matrixAutoUpdate={false} matrix={assembled}>
          {sketchLines.map((line, i) => (
            <Line
              key={i}
              points={line.points}
              color={highlightIds.includes(line.partId) || line.partId === selectedId ? kStudioPicked : '#1f6fc5'}
              lineWidth={highlightIds.includes(line.partId) || line.partId === selectedId ? 2.5 : 1.5}
            />
          ))}
        </group>
      )}
      {view === 'assembled' &&
        onPickRegion &&
        regions.map(region => <Region key={region.id} region={region} model={assembled} onPick={() => onPickRegion(region.id)} />)}
      {showOrigin && view === 'assembled' && (
        <group matrixAutoUpdate={false} matrix={assembled}>
          <Html center position={[0, 0, 0]} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
            <div
              data-testid="model-origin"
              aria-label="Origin"
              style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff', border: `2px solid ${kPlane}` }}
            />
          </Html>
        </group>
      )}
      {shownPlanes.map(plane => (
        <Plane key={plane.id} plane={plane} size={planeSize} model={assembled} onPick={onPickPlane && (() => onPickPlane(plane.id))} />
      ))}
      {!sketchView && onViewRequest && <ViewCube onViewRequest={onViewRequest} />}
      {!sketchView && <OrbitControls makeDefault dampingFactor={kOrbitDamping} mouseButtons={kCadMouseButtons} />}
    </Canvas>
  );
}
