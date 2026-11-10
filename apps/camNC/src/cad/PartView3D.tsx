import { Edges, Line } from '@react-three/drei';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import {
  evaluateCadPart,
  partFaceAt,
  CAD_IDENTITY_PLACEMENT,
  type CadDrawnOn,
  pointInPolygon,
  type CadCutDepth,
  type CadDocument,
  type CadFaceRef,
  type CadPart,
  type CadValueScope,
} from '@wbcnc/cad';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { FitCamera } from '@/cam/model/ModelViewport';
import { ModelOrbitControls } from '@/cam/model/ModelOrbitControls';
import { kOrbitSurface } from '@/cam/model/orbitPicking';
import { partSolid } from './partSolid';
import type { StudioCameraRef } from './studioCamera';
import type { PartViewSnapshot } from './faceSketchScene';
import type { FacePlane } from '@/cam/model/faceHighlight';
import { PartFaceHighlight } from './PartFaceHighlight';
import {
  cutRegions,
  depthLabel,
  exposedHeightAt,
  regionFace,
  regionSurfaceZ,
  regionWorldZ,
  withRegionDepth,
  type CutRegion,
} from './cutRegions';
import { draggedDepth, heightOnAxis } from './partViewDrag';
import { RegionDepthField } from './RegionDepthField';

const kWood = '#c9a477';
const kPick = '#8b5cf6';
const kSketch = '#3f5f8a';
/** A region's pick surface sits just over the face it stands for, so it wins against that face. */
const kLift = 0.01;
const kPartViewDirection: [number, number, number] = [0.2, -0.75, 1];
const faceLabel = (face: CadFaceRef | { edge: string }) =>
  face === 'top' ? 'top' : face === 'underside' ? 'underside' : 'edge' in face ? 'side face' : 'pocket floor';
const alone = (part: CadPart): CadDocument => ({ version: 2, id: 'part-view', name: part.name, revision: 0, parts: [part] });

const outlineOf = (part: CadPart) => evaluateCadPart(part).part?.outline ?? [];

function partBox(part: CadPart) {
  const box = new THREE.Box3();
  for (const p of outlineOf(part)) box.expandByPoint(new THREE.Vector3(p.x, p.y, 0));
  return box.expandByPoint(new THREE.Vector3(box.min.x, box.min.y, part.thickness));
}

function RegionSurface({
  entry,
  z,
  surface,
  order,
  lit,
  heightAt,
  onHover,
  onPick,
}: {
  entry: CutRegion;
  z: number;
  /** Its height counted from its own face, to compare with `heightAt`. */
  surface: number;
  /** A later sketch's region lifts over an earlier one at the same height, such as a sketch on a pocket's floor. */
  order: number;
  lit: boolean;
  heightAt: (point: { x: number; y: number }) => number;
  onHover: (over: boolean) => void;
  onPick: (event: ThreeEvent<MouseEvent>) => void;
}) {
  const shape = useMemo(() => {
    const outline = new THREE.Shape(entry.region.points.map(p => new THREE.Vector2(p.x, p.y)));
    outline.holes = entry.region.holes.map(hole => new THREE.Path(hole.map(p => new THREE.Vector2(p.x, p.y))));
    return outline;
  }, [entry.region]);
  return (
    <mesh
      position={[0, 0, z + (entry.side === 'underside' ? -1 : 1) * kLift * (1 + order)]}
      onPointerMove={event => {
        // Where another sketch's cut goes deeper, this surface is only air, so what's below gets the event.
        if (heightAt(event.point) < surface) return onHover(false);
        event.stopPropagation();
        onHover(true);
      }}
      onPointerOut={() => onHover(false)}
      onClick={event => {
        if (heightAt(event.point) < surface) return;
        event.stopPropagation();
        // A drag that started here was an orbit, not a pick.
        if (event.delta <= 4) onPick(event);
      }}>
      <shapeGeometry args={[shape]} />
      <meshBasicMaterial color={kPick} transparent opacity={lit ? 0.4 : 0} depthWrite={false} side={THREE.DoubleSide} />
      {/* Always drawn, so a finished sketch can be seen on the part, and it's clear what there is to click. */}
      <Line
        points={[...entry.region.points, entry.region.points[0]!].map(p => [p.x, p.y, 0.01] as const)}
        color={lit ? kPick : kSketch}
        lineWidth={lit ? 2 : 1}
      />
    </mesh>
  );
}

/** Drags a region's depth, from a grip that stays above the part so no wall ever hides it. */
function DepthArrow({
  at,
  surface,
  thickness,
  below,
  left,
  size,
  depth,
  onDrag,
  onRelease,
}: {
  at: { x: number; y: number };
  surface: number;
  thickness: number;
  below: boolean;
  /** Material left under where the cut starts. */
  left: number;
  size: number;
  depth: CadCutDepth;
  onDrag: (depth: CadCutDepth | null) => void;
  onRelease: () => void;
}) {
  const grab = useRef<{ height: number; depth: CadCutDepth } | null>(null);
  const height = (event: ThreeEvent<PointerEvent>) => heightOnAxis(event.ray.origin, event.ray.direction, at);
  const shaftTop = thickness + size;
  const shaft = shaftTop - surface;
  return (
    <group
      // From below, the same arrow stands on the far side of the part, pointing down.
      position={[at.x, at.y, below ? thickness : 0]}
      scale={[1, 1, below ? -1 : 1]}
      onPointerDown={event => {
        event.stopPropagation();
        const start = height(event);
        if (start === null) return;
        (event.target as unknown as Element).setPointerCapture(event.pointerId);
        grab.current = { height: start, depth };
        onDrag(depth);
      }}
      onPointerMove={event => {
        event.stopPropagation();
        const now = grab.current && height(event);
        if (grab.current && now !== null) onDrag(draggedDepth(grab.current.depth, (now - grab.current.height) * (below ? -1 : 1), left));
      }}
      onPointerUp={event => {
        event.stopPropagation();
        (event.target as unknown as Element).releasePointerCapture(event.pointerId);
        if (grab.current) onRelease();
        grab.current = null;
      }}
      onClick={event => event.stopPropagation()}>
      <mesh position={[0, 0, surface + shaft / 2]} rotation={[Math.PI / 2, 0, 0]} renderOrder={2}>
        <cylinderGeometry args={[size * 0.05, size * 0.05, shaft, 12]} />
        <meshBasicMaterial color={kPick} depthTest={false} transparent />
      </mesh>
      <mesh position={[0, 0, shaftTop + size * 0.15]} rotation={[Math.PI / 2, 0, 0]} renderOrder={2}>
        <coneGeometry args={[size * 0.16, size * 0.3, 16]} />
        <meshBasicMaterial color={kPick} depthTest={false} transparent />
      </mesh>
      {/* Wider than it looks, so the grip is easy to catch. */}
      <mesh position={[0, 0, thickness + size * 0.65]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[size * 0.25, size * 0.25, size * 0.9, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** The middle of a region, or where it was clicked when its middle is outside it, as in a ring. */
function regionCenter({ region }: CutRegion, clicked: { x: number; y: number }) {
  const center = region.points.reduce((sum, p) => ({ x: sum.x + p.x / region.points.length, y: sum.y + p.y / region.points.length }), {
    x: 0,
    y: 0,
  });
  return pointInPolygon(center, region.points) && !region.holes.some(hole => pointInPolygon(center, hole)) ? center : clicked;
}

/** One part in 3D, as it'll be cut. Click a region to set its depth, or drag the arrow to push its floor up and down. */
export default function PartView3D({
  part,
  document,
  variables,
  onChoose,
  onSketchFace,
  onSketchSide,
  cameraState: givenCamera,
}: {
  part: CadPart;
  /** The design the part is in, whose other parts may cut it. */
  document?: CadDocument;
  /** Design variables a typed depth may use. */
  variables?: CadValueScope;
  onChoose: (entry: CutRegion, depth: CadCutDepth, expression?: string) => void;
  onSketchFace?: (face: CadFaceRef, view?: PartViewSnapshot) => void;
  cameraState?: StudioCameraRef;
  onSketchSide?: (face: Extract<CadDrawnOn['on'], { partId: string }>['face'], view: PartViewSnapshot) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ id: string; at: { x: number; y: number }; screen: { x: number; y: number } } | null>(null);
  const [dragging, setDragging] = useState<CadCutDepth | null>(null);
  const [facePicked, setFacePicked] = useState<Extract<CadDrawnOn['on'], { partId: string }>['face'] | null>(null);
  const [pickedPlane, setPickedPlane] = useState<FacePlane | null>(null);
  const ownCamera = useRef<StudioCameraRef['current']>(null);
  const cameraState = givenCamera ?? ownCamera;
  const regions = useMemo(() => cutRegions(part), [part]);
  const entry = regions.find(candidate => candidate.region.id === picked?.id) ?? null;
  // A drag shows the real solid at each half millimetre, without committing anything until it's let go.
  const shown = useMemo(() => {
    if (dragging === null || !entry) return part;
    return withRegionDepth(alone(part), part.id, entry, dragging).parts[0]!;
  }, [part, entry, dragging]);
  const solid = useMemo(() => partSolid(shown, document), [shown, document]);
  const shownRegions = useMemo(() => cutRegions(shown), [shown]);
  useEffect(() => () => solid.geometry?.dispose(), [solid]);
  // The camera frames the part once, and stays put while its cuts change.
  const [box] = useState(() => partBox(part));
  const size = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, part.thickness * 2) * 0.12;
  const depth = dragging ?? entry?.depth ?? 0;
  const face = entry ? regionFace(entry) : facePicked;
  // The editor's keys work from here as soon as the view opens.
  useEffect(() => frame.current?.focus({ preventScroll: true }), []);
  const pick = (candidate: CutRegion, event: ThreeEvent<MouseEvent>) => {
    const rect = frame.current!.getBoundingClientRect();
    setFacePicked(null);
    setPickedPlane(null);
    setPicked({
      id: candidate.region.id,
      at: regionCenter(candidate, event.point),
      screen: {
        x: Math.max(8, Math.min(event.nativeEvent.clientX - rect.left + 12, rect.width - 288)),
        y: Math.max(8, Math.min(event.nativeEvent.clientY - rect.top + 12, rect.height - 48)),
      },
    });
  };
  return (
    // Holds focus so the editor's keys, like undo, keep working from here.
    <div
      ref={frame}
      className="cad-part-view"
      data-testid="part-3d"
      tabIndex={-1}
      onPointerDown={() => frame.current?.focus({ preventScroll: true })}>
      <Canvas
        orthographic
        camera={{ fov: 30 }}
        dpr={[1, 2]}
        onPointerMissed={() => {
          setPicked(null);
          setFacePicked(null);
          setPickedPlane(null);
        }}>
        <hemisphereLight args={['#ffffff', '#8a8178', 1.4]} position={[0, 0, 1]} />
        <directionalLight position={[300, -500, 800]} intensity={1.8} />
        <directionalLight position={[-400, 300, 200]} intensity={0.4} />
        {/* Enough light underneath to work on the underside. */}
        <directionalLight position={[200, -300, -800]} intensity={1.1} />
        <FitCamera box={box} fitKey={part.id} cameraState={cameraState} initialDirection={kPartViewDirection} />
        {solid.geometry && (
          <mesh
            geometry={solid.geometry}
            userData={kOrbitSurface}
            position={[solid.origin![0], solid.origin![1], 0]}
            onPointerMove={event => {
              event.stopPropagation();
              setHovered(null);
            }}
            onClick={event => {
              event.stopPropagation();
              if (event.delta > 4) return;
              setPicked(null);
              setPickedPlane(event.face ? { point: event.point.toArray(), normal: event.face.normal.toArray() } : null);
              // Side profiles are separate studio features; the local depth editor still handles top and underside cuts.
              setFacePicked(
                event.point.z > part.thickness - kLift
                  ? 'top'
                  : event.point.z < kLift
                    ? 'underside'
                    : onSketchSide && event.face
                      ? partFaceAt(part, CAD_IDENTITY_PLACEMENT, event.point.toArray(), event.face.normal.toArray())
                      : null
              );
            }}>
            <meshStandardMaterial vertexColors color={kWood} roughness={0.8} />
            <Edges geometry={solid.geometry} threshold={30} color="#5b4a36" />
          </mesh>
        )}
        {pickedPlane && solid.geometry && <PartFaceHighlight geometry={solid.geometry} origin={solid.origin!} face={pickedPlane} />}
        {facePicked && typeof facePicked === 'string' && (
          <Line
            points={[...outlineOf(part), outlineOf(part)[0]!].map(
              p => [p.x, p.y, facePicked === 'top' ? part.thickness + kLift : -kLift] as const
            )}
            color={kPick}
            lineWidth={3}
          />
        )}
        {shownRegions.map((candidate, order) => (
          <RegionSurface
            key={candidate.region.id}
            entry={candidate}
            z={regionWorldZ(candidate, part.thickness)}
            surface={regionSurfaceZ(candidate, part.thickness)}
            order={order}
            lit={candidate.region.id === picked?.id || candidate.region.id === hovered}
            heightAt={point =>
              exposedHeightAt(
                shownRegions.filter(other => other.side === candidate.side),
                part.thickness,
                point
              )
            }
            onHover={over => setHovered(current => (over ? candidate.region.id : current === candidate.region.id ? null : current))}
            onPick={event => pick(candidate, event)}
          />
        ))}
        {entry && picked && (
          <DepthArrow
            at={picked.at}
            surface={regionSurfaceZ({ depth, from: entry.from }, part.thickness)}
            thickness={part.thickness}
            below={entry.side === 'underside'}
            left={part.thickness - entry.from}
            size={size}
            depth={entry.depth}
            onDrag={setDragging}
            onRelease={() => {
              if (dragging !== null && dragging !== entry.depth) onChoose(entry, dragging);
              setDragging(null);
            }}
          />
        )}
        <ModelOrbitControls box={box} enabled={dragging === null} />
      </Canvas>
      {entry && picked && dragging === null && (
        <RegionDepthField
          key={`${entry.region.id}:${String(entry.depth)}`}
          style={{ left: picked.screen.x, top: picked.screen.y }}
          depth={entry.depth}
          expression={entry.cut?.depthExpression}
          thickness={part.thickness - entry.from}
          variables={variables}
          onClose={() => {
            setPicked(null);
            frame.current?.focus({ preventScroll: true });
          }}
          onChoose={(next, expression) => {
            if (next !== entry.depth || expression !== entry.cut?.depthExpression) onChoose(entry, next, expression);
            setPicked(null);
            frame.current?.focus({ preventScroll: true });
          }}
        />
      )}
      {onSketchFace && (
        <div className="cad-part-view-tools">
          <button
            type="button"
            disabled={!face}
            onClick={() => {
              if (!face) return;
              const canvas = frame.current?.querySelector('canvas');
              const bounds = canvas?.getBoundingClientRect();
              const snapshot = cameraState.current && bounds?.height ? { cameraState, aspect: bounds.width / bounds.height } : undefined;
              if (typeof face === 'object' && 'edge' in face) {
                if (snapshot) onSketchSide?.(face, snapshot);
              } else onSketchFace(face, snapshot);
            }}>
            Sketch{face ? ` on ${faceLabel(face)}` : ''}
          </button>
        </div>
      )}
      <p>
        {solid.problem
          ? solid.problem
          : entry
            ? `${depthLabel({ ...entry, depth })}. Type a depth, or drag the arrow.`
            : regions.length
              ? 'Click a region to set its depth, or a face to sketch on. Right-drag to turn, middle-drag to pan.'
              : 'Click the top face, then Sketch, to draw what to cut.'}
      </p>
    </div>
  );
}
