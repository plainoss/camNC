import { Html, Line } from '@react-three/drei';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { BodyMesh, CamPartInfo } from '../camTypes';
import { ViewCube } from './ViewCube';
import { ModelBody } from './ModelBody';
import { ModelOrbitControls } from './ModelOrbitControls';
import { kOrbitSurface } from './orbitPicking';
import { settledCanvas } from '@/lib/settledCanvas';
import { ModelSectionCap } from './ModelSectionCap';
import { SectionOffsetHandle, type SectionOffsetControl } from './SectionOffsetHandle';
import type { SectionCapRange } from '@/cad/sectionModel';
import { ModelFaceHighlight } from './ModelFaceHighlight';
import { ExtrudeDepthArrow } from './ExtrudeDepthArrow';
import type { ExtrudeDepthControl } from '@/cad/extrudeDepth';
import { sameFacePlane } from './faceHighlight';
import { ModelConnector, type ViewConnector } from './ModelConnector';
import { snapToFace } from './faceSnap';
import { nearestEdgeBy, screenDistance, type ModelEdge } from './edgePick';
import { CameraTap } from './CameraTap';
import { edgeNearMiss } from './edgeNearMiss';
import { measurementEntityAt, type ModelMeasurePick } from './measurementPick';
import { ModelMeasurement, type ModelMeasureWitness } from './ModelMeasurement';
import { ModelLights } from './ModelLights';
import { centerAssembled, explodeAssembled, interpolateExplosion, layoutFlat } from './layoutFlat';
import type { StudioCameraRef } from '@/cad/studioCamera';
import type { MeasureEntity } from '@/cad/measureGeometry';

import { FitCamera, SketchCamera, type SketchView, type ViewRequest } from './ViewCameras';
import { kPlane, Plane, Region, type ViewPlane, type ViewRegion } from './ViewPlanes';

export { FitCamera, SketchCamera, type SketchView, type ViewRequest } from './ViewCameras';
export type { ViewPlane, ViewRegion } from './ViewPlanes';

export type ModelView = 'assembled' | 'exploded' | 'flat';
/** A finished sketch's curve in the model, by the sketch's part. */
/** How parts are drawn in the view. */
export type ModelDisplay = 'edges' | 'shaded' | 'translucent';

export interface SketchLine {
  partId: string;
  points: [number, number, number][];
}
const kNoLines: SketchLine[] = [];
/** A face clicked on a part, in the model's own space: its nearest corner or its middle, and the way it faces. */
export interface ModelFacePick {
  partId: string;
  /** Which of the meshes was clicked, for a part shown more than once. */
  index: number;
  point: [number, number, number];
  /** The exact ray hit remains on the clicked plane even when a mate-style snap chooses a bounding-box midpoint. */
  surfacePoint?: [number, number, number];
  normal: [number, number, number];
  /** The part's straight edge, when the click was this close to one, end to end. */
  edge?: ModelEdge;
  /** Temporary cut surfaces can be measured but do not define a new feature's source face. */
  sectionCap?: boolean;
}

/** How close to an edge, in screen pixels, a click picks it. */
const kEdgePixels = 8;
const kWood = '#c9a477';
const kSelected = '#8b5cf6';
const kOff = '#71717a';
const kClash = '#dc2626';
// The studio's parts, as the reference shows them: a neutral grey, picked in orange, with no colour for overlaps.
const kStudioPart = '#b8c0c9';
const kStudioPicked = '#f39c2c';

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
  explosionProgress = 1,
  selectedId,
  milled,
  highlightIds = [],
  selectedIndexes,
  selectedFace,
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
  display = 'shaded',
  palette,
  regions = [],
  onPickRegion,
  cameraState,
  extrusionDepth,
  onPickSketch,
  pickingConnector = false,
  connectors = [],
  onMeasurePick,
  measuring = false,
  measureSelection = [],
  measureWitness,
  sectionCaps = [],
  sectionControl,
  sourceMeshes,
}: {
  meshes: BodyMesh[];
  parts: CamPartInfo[];
  view: ModelView;
  /** 0 is assembled, 1 is fully exploded; ignored by the other layouts. */
  explosionProgress?: number;
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
  /** How parts are drawn: shaded with their edges, shaded only, or see-through. */
  display?: ModelDisplay;
  /** `studio` shows parts as the reference does: grey, picked in orange. */
  palette?: 'studio';
  /** A sketch's regions to pick for an extrude, and picking one. */
  regions?: ViewRegion[];
  onPickRegion?: (id: string) => void;
  cameraState?: StudioCameraRef;
  extrusionDepth?: ExtrudeDepthControl | null;
  onPickSketch?: (id: string) => void;
  selectedFace?: ModelFacePick | null;
  pickingConnector?: boolean;
  connectors?: ViewConnector[];
  /** A geometry click in assembly coordinates, alongside ordinary part selection unless measuring is active. */
  onMeasurePick?: (pick: ModelMeasurePick) => void;
  /** The expanded measure tool picks geometry without opening or changing the selected part. */
  measuring?: boolean;
  measureSelection?: readonly MeasureEntity[];
  measureWitness?: ModelMeasureWitness;
  sectionCaps?: readonly (SectionCapRange | null)[];
  sectionControl?: SectionOffsetControl | null;
  /** Persistent feature inputs snap to the original body, while inspection measures the visible clipped body. */
  sourceMeshes?: readonly BodyMesh[];
}) {
  const [hoveredConnector, setHoveredConnector] = useState<ModelFacePick | null>(null);
  // A new pick must not briefly reuse a marker from an earlier dialog or different geometry.
  useEffect(() => setHoveredConnector(null), [pickingConnector, meshes]);
  const [hoveredFace, setHoveredFace] = useState<ModelFacePick | null>(null);
  const flat = useMemo(() => layoutFlat(meshes, parts), [meshes, parts]);
  // The studio shows a design where it is, about its origin, so hiding a part doesn't shift the rest.
  const assembled = useMemo(() => (palette === 'studio' ? new THREE.Matrix4() : centerAssembled(meshes)), [meshes, palette]);
  const exploded = useMemo(() => explodeAssembled(meshes, assembled), [meshes, assembled]);
  const camera = useRef<THREE.Camera | null>(null);
  const matrices = useMemo(
    () =>
      view === 'flat'
        ? flat
        : view === 'exploded'
          ? interpolateExplosion(assembled, exploded, explosionProgress)
          : meshes.map(() => assembled),
    [view, flat, exploded, assembled, meshes, explosionProgress]
  );
  // Fit the complete travel once, so the first animated frame doesn't crop the final exploded parts.
  const explosionBox = useMemo(
    () =>
      boundsOf(meshes, exploded).union(
        boundsOf(
          meshes,
          meshes.map(() => assembled)
        )
      ),
    [meshes, exploded, assembled]
  );
  // Size the normal display planes around the origin and model, with a useful extent before any geometry exists.
  const modelPlaneSize = useMemo(() => {
    const reach = boundsOf(
      meshes,
      meshes.map(() => new THREE.Matrix4())
    );
    for (const line of sketchLines) for (const point of line.points) reach.expandByPoint(new THREE.Vector3(...point));
    if (reach.isEmpty()) return palette === 'studio' ? 150 : 100;
    const half = Math.max(...reach.min.toArray().map(Math.abs), ...reach.max.toArray().map(Math.abs));
    return Math.max(palette === 'studio' ? 150 : 100, half * 2.2);
  }, [meshes, sketchLines, palette]);
  // While the depth arrow is present, changing model bounds must not resize its reference planes.
  // Retain the previous extent, including after pointer release and subsequent depth changes.
  const referencePlaneSize = useRef(modelPlaneSize);
  if (!extrusionDepth) referencePlaneSize.current = modelPlaneSize;
  const planeSize = extrusionDepth ? referencePlaneSize.current : modelPlaneSize;
  const shownPlanes = view === 'assembled' ? planes : [];
  const geometryBox = useMemo(() => {
    // Playback and scrubbing keep a stable rotation center without rescanning every vertex each frame.
    if (view === 'exploded') return explosionBox;
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
    return fit;
  }, [meshes, matrices, assembled, sketchLines, regions, view, explosionBox]);
  const box = useMemo(() => {
    const fit = geometryBox.clone();
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
  }, [geometryBox, shownPlanes.length, planeSize, assembled]);
  const orbitBox = useMemo(() => {
    // Plane squares grow to make them easy to see. Their display extents must not move the model's rotation center.
    const bounds = geometryBox.clone();
    if (showOrigin && view === 'assembled') bounds.expandByPoint(new THREE.Vector3().applyMatrix4(assembled));
    // Before any geometry exists, the visible planes still provide their actual origins as rotation anchors.
    if (bounds.isEmpty() && view === 'assembled')
      for (const plane of planes) bounds.expandByPoint(new THREE.Vector3(...plane.origin).applyMatrix4(assembled));
    return bounds;
  }, [geometryBox, showOrigin, view, assembled, planes]);
  const colorOf = (mesh: BodyMesh, index: number) =>
    (selectedIndexes ? selectedIndexes.includes(index) : mesh.partId === selectedId) || highlightIds.includes(mesh.partId)
      ? palette === 'studio'
        ? kStudioPicked
        : kSelected
      : warnIds.includes(mesh.partId)
        ? kClash
        : !milled(mesh.partId)
          ? kOff
          : palette === 'studio'
            ? kStudioPart
            : kWood;
  const opacityOf = (mesh: BodyMesh, index: number) =>
    display === 'translucent' || transparentIds?.has(instanceIds?.[index] ?? mesh.partId) ? 0.3 : milled(mesh.partId) ? 1 : 0.35;
  const sectionCapAt = (index: number, faceIndex: number | null | undefined) => {
    const range = sectionCaps[index];
    return !!range && faceIndex != null && faceIndex * 3 >= range.start && faceIndex * 3 < range.start + range.count;
  };
  const pick = (mesh: BodyMesh, index: number, matrix: THREE.Matrix4, e: ThreeEvent<MouseEvent>) => {
    // A captured depth or section drag must not also select the face beneath its release point.
    if (extrusionDepth?.dragging || sectionControl?.dragging) return;
    if (!e.face) return onSelect(mesh.partId, index);
    // Back from where the view drew it to where the part sits in the model.
    const point = e.point.clone().applyMatrix4(matrix.clone().invert()),
      normal = e.face.normal.clone().normalize().toArray();
    // Within a few pixels of an edge on screen, the edge is picked too, unless the click is on one of its corners.
    const canvas = e.nativeEvent.target as HTMLElement;
    const screen = screenDistance(e.camera, matrix, canvas.clientWidth, canvas.clientHeight, e.pointer);
    if (!onPickFace && onMeasurePick && view === 'assembled' && e.faceIndex != null) {
      const entity = measurementEntityAt(mesh.positions, mesh.indices, e.faceIndex, screen, canvas.clientWidth ? kEdgePixels : 0);
      if (entity) onMeasurePick({ partId: mesh.partId, index, entity, additive: e.shiftKey });
      // Shift explicitly adds measurement geometry; a second quick pick must not reach the part double-click editor.
      if (measuring || (entity && e.shiftKey)) return;
    }
    const source = sourceMeshes?.[index] ?? mesh;
    const edge = canvas.clientWidth ? nearestEdgeBy(source.positions, source.indices, screen.segment, kEdgePixels) : null;
    const near = edge && Math.min(screen.point(edge.a), screen.point(edge.b)) > kEdgePixels ? edge : null;
    const face: ModelFacePick = {
      partId: mesh.partId,
      index,
      point: snapToFace(source.positions, point.toArray(), normal),
      surfacePoint: point.toArray(),
      normal,
      ...(sectionCapAt(index, e.faceIndex) && { sectionCap: true }),
      ...(near && { edge: near }),
    };
    if (onPickFace) onPickFace(face);
    else onSelect(mesh.partId, index, face);
  };
  return (
    <Canvas
      {...settledCanvas}
      // Drawn when something changes, not every frame, so an idle view costs nothing.
      frameloop="demand"
      orthographic={palette === 'studio'}
      camera={{ fov: 30 }}
      dpr={[1, 2]}
      onPointerLeave={() => {
        onHover?.(null);
        setHoveredFace(null);
        setHoveredConnector(null);
      }}
      onPointerMissed={event => {
        onHover?.(null);
        setHoveredConnector(null);
        // Picking a point or an edge, a click just off a part's edge, such as one seen edge-on, picks that edge.
        const canvas = event.target instanceof HTMLCanvasElement ? event.target : null;
        if (pickingConnector && canvas && camera.current) {
          const box = canvas.getBoundingClientRect();
          const pointer = { x: ((event.clientX - box.left) / box.width) * 2 - 1, y: -((event.clientY - box.top) / box.height) * 2 + 1 };
          const bodies = meshes.map((mesh, i) => ({ ...(sourceMeshes?.[i] ?? mesh), matrix: matrices[i]! }));
          const near = edgeNearMiss(camera.current, bodies, { width: box.width, height: box.height }, pointer, kEdgePixels);
          if (near) {
            const mesh = meshes[near.index]!;
            const point = near.edge.a.map((value, axis) => (value + near.edge.b[axis]!) / 2) as [number, number, number];
            const face: ModelFacePick = {
              partId: mesh.partId,
              index: near.index,
              point,
              surfacePoint: point,
              normal: [0, 0, 1],
              edge: near.edge,
            };
            return onPickFace ? onPickFace(face) : onSelect(mesh.partId, near.index, face);
          }
        }
        onMissed?.();
      }}>
      <CameraTap cameraRef={camera} />
      <ModelLights />
      {sketchView ? (
        <SketchCamera view={sketchView} model={assembled} />
      ) : (
        <FitCamera box={view === 'exploded' ? explosionBox : box} fitKey={view} viewRequest={viewRequest} cameraState={cameraState} />
      )}
      <group>
        {meshes.map(
          (m, i) =>
            m.indices.length > 0 && (
              <ModelBody
                key={i}
                mesh={m}
                sectionCap={sectionCaps[i] ?? undefined}
                matrix={matrices[i]!}
                color={colorOf(m, i)}
                opacity={opacityOf(m, i)}
                edges={display === 'edges'}
                onSelect={e => pick(m, i, matrices[i]!, e)}
                onHover={(hovered, event) => {
                  onHover?.(hovered ? m.partId : null, hovered ? i : undefined);
                  if (pickingConnector) {
                    // The marker must preview the persistent source snap, never a temporary cut face or its bounds.
                    if (hovered && event?.face && !sectionCapAt(i, event.faceIndex)) {
                      const point = event.point.clone().applyMatrix4(matrices[i]!.clone().invert()).toArray();
                      const normal = event.face.normal.clone().normalize().toArray();
                      const source = sourceMeshes?.[i] ?? m;
                      setHoveredConnector({ partId: m.partId, index: i, point: snapToFace(source.positions, point, normal), normal });
                    } else setHoveredConnector(current => (current?.index === i ? null : current));
                  }
                  if (palette !== 'studio') return;
                  if (!hovered || !event?.face) return setHoveredFace(current => (current?.index === i ? null : current));
                  const point = event.point.clone().applyMatrix4(matrices[i]!.clone().invert()).toArray();
                  const face: ModelFacePick = { partId: m.partId, index: i, point, normal: event.face.normal.toArray() };
                  setHoveredFace(current => (current?.index === i && sameFacePlane(current, face) ? current : face));
                }}
              />
            )
        )}
      </group>
      {meshes.map(
        (mesh, index) =>
          sectionCaps[index] && (
            <ModelSectionCap
              key={index}
              mesh={mesh}
              range={sectionCaps[index]!}
              matrix={matrices[index]!}
              color={colorOf(mesh, index)}
              opacity={opacityOf(mesh, index)}
            />
          )
      )}
      {[
        selectedFace,
        hoveredFace && !(selectedFace?.index === hoveredFace.index && sameFacePlane(selectedFace, hoveredFace)) ? hoveredFace : null,
      ].map(
        (face, index) =>
          face &&
          meshes[face.index] && (
            <ModelFaceHighlight key={index} mesh={meshes[face.index]!} matrix={matrices[face.index]!} face={face} selected={index === 0} />
          )
      )}
      {view === 'assembled' && (
        <>
          {connectors.map(connector => (
            <ModelConnector key={connector.label} connector={connector} model={assembled} />
          ))}
          {pickingConnector && hoveredConnector && (
            <ModelConnector connector={{ ...hoveredConnector, label: 'Mate connector under pointer' }} model={assembled} />
          )}
        </>
      )}
      {view === 'assembled' && (measureSelection.length > 0 || measureWitness) && (
        <group matrixAutoUpdate={false} matrix={assembled}>
          <ModelMeasurement selection={measureSelection} witness={measureWitness} />
        </group>
      )}
      {view === 'assembled' && sketchLines.length > 0 && (
        <group matrixAutoUpdate={false} matrix={assembled}>
          {sketchLines.map((line, i) => (
            <Line
              key={i}
              userData={kOrbitSurface}
              points={line.points}
              color={highlightIds.includes(line.partId) || line.partId === selectedId ? kStudioPicked : '#1f6fc5'}
              lineWidth={highlightIds.includes(line.partId) || line.partId === selectedId ? 2.5 : 1.5}
              onClick={
                onPickSketch
                  ? event => {
                      event.stopPropagation();
                      if (event.delta <= 4) onPickSketch(line.partId);
                    }
                  : undefined
              }
            />
          ))}
        </group>
      )}
      {view === 'assembled' &&
        onPickRegion &&
        regions.map(region => <Region key={region.id} region={region} model={assembled} onPick={() => onPickRegion(region.id)} />)}
      {showOrigin && view === 'assembled' && (
        <group matrixAutoUpdate={false} matrix={assembled}>
          <Html center zIndexRange={[5, 0]} position={[0, 0, 0]} style={{ pointerEvents: 'none' }}>
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
      {extrusionDepth && view === 'assembled' && <ExtrudeDepthArrow key={extrusionDepth.partId} control={extrusionDepth} />}
      {sectionControl && view === 'assembled' && (
        <SectionOffsetHandle
          control={{ ...sectionControl, origin: new THREE.Vector3(...sectionControl.origin).applyMatrix4(assembled).toArray() }}
        />
      )}
      {!sketchView && onViewRequest && <ViewCube onViewRequest={onViewRequest} />}
      {!sketchView && <ModelOrbitControls box={orbitBox} enabled={!extrusionDepth?.dragging && !sectionControl?.dragging} />}
    </Canvas>
  );
}
