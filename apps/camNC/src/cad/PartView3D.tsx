import { Edges, OrbitControls } from '@react-three/drei';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { evaluateCadFeatures, evaluateCadPart, type CadCutDepth, type CadDocument, type CadPart } from '@wbcnc/cad';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { FitCamera } from '@/cam/model/ModelViewport';
import { modelGeometry } from '@/cam/model/modelGeometry';
import { nativePart } from '@/cam/nativeCadModel';
import { kOrbitDamping } from '@/lib/orbitDamping';
import { cutRegions, depthLabel, exposedHeightAt, regionSurfaceZ, withRegionDepth, type CutRegion } from './cutRegions';
import { draggedDepth, heightOnAxis } from './partViewDrag';
import { RegionDepthField } from './RegionDepthField';

const kWood = '#c9a477';
const kPick = '#8b5cf6';
/** A region's pick surface sits just over the face it stands for, so it wins against that face. */
const kLift = 0.02;
const alone = (part: CadPart): CadDocument => ({ version: 2, id: 'part-view', name: part.name, revision: 0, parts: [part] });

/** The part as it'll be cut, or why it can't be shown. Uses the same mesh CAM reads back. */
function partSolid(part: CadPart): { geometry?: THREE.BufferGeometry; origin?: [number, number]; problem?: string } {
  const { part: profile } = evaluateCadPart(part);
  if (!profile) return { problem: 'This part can’t be shown until its sketch is fixed.' };
  // A cut with an error is left out and explained, so the part stays on screen while it's put right.
  const { part: evaluated, diagnostics } = evaluateCadFeatures(part, profile),
    problem = diagnostics.find(diagnostic => diagnostic.severity === 'error')?.message;
  try {
    const { mesh, info } = nativePart(evaluated);
    return { geometry: modelGeometry(mesh), origin: info.sourceOrigin, problem };
  } catch (cause) {
    return { problem: cause instanceof Error ? cause.message : String(cause) };
  }
}

function partBox(part: CadPart) {
  const box = new THREE.Box3();
  for (const p of evaluateCadPart(part).part?.outline ?? []) box.expandByPoint(new THREE.Vector3(p.x, p.y, 0));
  return box.expandByPoint(new THREE.Vector3(box.min.x, box.min.y, part.thickness));
}

function RegionSurface({
  entry,
  z,
  lit,
  heightAt,
  onHover,
  onPick,
}: {
  entry: CutRegion;
  z: number;
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
      position={[0, 0, z + kLift]}
      onPointerMove={event => {
        // Where another sketch's cut goes deeper, this surface is only air, so what's below gets the event.
        if (heightAt(event.point) < z) return onHover(false);
        event.stopPropagation();
        onHover(true);
      }}
      onPointerOut={() => onHover(false)}
      onClick={event => {
        if (heightAt(event.point) < z) return;
        event.stopPropagation();
        // A drag that started here was an orbit, not a pick.
        if (event.delta <= 4) onPick(event);
      }}>
      <shapeGeometry args={[shape]} />
      <meshBasicMaterial color={kPick} transparent opacity={lit ? 0.4 : 0} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** Drags a region's depth, from a grip that stays above the part so no wall ever hides it. */
function DepthArrow({
  at,
  surface,
  thickness,
  size,
  depth,
  onDrag,
  onRelease,
}: {
  at: { x: number; y: number };
  surface: number;
  thickness: number;
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
      position={[at.x, at.y, 0]}
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
        if (grab.current && now !== null) onDrag(draggedDepth(grab.current.depth, now - grab.current.height, thickness));
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

/** One part in 3D, as it'll be cut. Click a region to set its depth, or drag the arrow to push its floor up and down. */
export default function PartView3D({ part, onChoose }: { part: CadPart; onChoose: (entry: CutRegion, depth: CadCutDepth) => void }) {
  const frame = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ id: string; at: { x: number; y: number }; screen: { x: number; y: number } } | null>(null);
  const [dragging, setDragging] = useState<CadCutDepth | null>(null);
  const regions = useMemo(() => cutRegions(part), [part]);
  const entry = regions.find(candidate => candidate.region.id === picked?.id) ?? null;
  // A drag shows the real solid at each half millimetre, without committing anything until it's let go.
  const shown = useMemo(() => {
    if (dragging === null || !entry) return part;
    return withRegionDepth(alone(part), part.id, entry, dragging).parts[0]!;
  }, [part, entry, dragging]);
  const solid = useMemo(() => partSolid(shown), [shown]);
  const shownRegions = useMemo(() => cutRegions(shown), [shown]);
  useEffect(() => () => solid.geometry?.dispose(), [solid]);
  // The camera frames the part once, and stays put while its cuts change.
  const [box] = useState(() => partBox(part));
  const size = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, part.thickness * 2) * 0.12;
  const depth = dragging ?? entry?.depth ?? 0;
  const pick = (candidate: CutRegion, event: ThreeEvent<MouseEvent>) => {
    const rect = frame.current!.getBoundingClientRect();
    setPicked({
      id: candidate.region.id,
      at: { x: event.point.x, y: event.point.y },
      screen: {
        x: Math.max(8, Math.min(event.nativeEvent.clientX - rect.left + 12, rect.width - 288)),
        y: Math.max(8, Math.min(event.nativeEvent.clientY - rect.top + 12, rect.height - 48)),
      },
    });
  };
  return (
    // Holds focus so the editor's keys, like undo, keep working from here.
    <div ref={frame} className="cad-part-view" data-testid="part-3d" tabIndex={-1} onPointerDown={() => frame.current?.focus()}>
      <Canvas camera={{ fov: 30 }} dpr={[1, 2]} onPointerMissed={() => setPicked(null)}>
        <hemisphereLight args={['#ffffff', '#8a8178', 1.4]} position={[0, 0, 1]} />
        <directionalLight position={[300, -500, 800]} intensity={1.8} />
        <directionalLight position={[-400, 300, 200]} intensity={0.4} />
        <FitCamera box={box} />
        {solid.geometry && (
          <mesh
            geometry={solid.geometry}
            position={[solid.origin![0], solid.origin![1], 0]}
            onPointerMove={event => {
              event.stopPropagation();
              setHovered(null);
            }}
            onClick={event => event.stopPropagation()}>
            <meshStandardMaterial vertexColors color={kWood} roughness={0.8} />
            <Edges threshold={30} color="#5b4a36" />
          </mesh>
        )}
        {shownRegions.map(candidate => (
          <RegionSurface
            key={candidate.region.id}
            entry={candidate}
            z={regionSurfaceZ(candidate.depth, part.thickness)}
            lit={candidate.region.id === picked?.id || candidate.region.id === hovered}
            heightAt={point => exposedHeightAt(shownRegions, part.thickness, point)}
            onHover={over => setHovered(current => (over ? candidate.region.id : current === candidate.region.id ? null : current))}
            onPick={event => pick(candidate, event)}
          />
        ))}
        {entry && picked && (
          <DepthArrow
            at={picked.at}
            surface={regionSurfaceZ(depth, part.thickness)}
            thickness={part.thickness}
            size={size}
            depth={entry.depth}
            onDrag={setDragging}
            onRelease={() => {
              if (dragging !== null && dragging !== entry.depth) onChoose(entry, dragging);
              setDragging(null);
            }}
          />
        )}
        <OrbitControls makeDefault enabled={dragging === null} dampingFactor={kOrbitDamping} />
      </Canvas>
      {entry && picked && dragging === null && (
        <RegionDepthField
          key={`${entry.region.id}:${String(entry.depth)}`}
          style={{ left: picked.screen.x, top: picked.screen.y }}
          depth={entry.depth}
          thickness={part.thickness}
          onClose={() => {
            setPicked(null);
            frame.current?.focus();
          }}
          onChoose={next => {
            if (next !== entry.depth) onChoose(entry, next);
            setPicked(null);
            frame.current?.focus();
          }}
        />
      )}
      <p>
        {solid.problem
          ? solid.problem
          : entry
            ? `${depthLabel({ ...entry, depth })}. Type a depth, or drag the arrow.`
            : regions.length
              ? 'Click a region to set its depth. Drag to orbit.'
              : 'Draw a closed shape inside the part, or a sketch on top, to make regions to cut.'}
      </p>
    </div>
  );
}
