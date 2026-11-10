import * as THREE from 'three';
import type { BodyMesh } from '@/cam/camTypes';
import { partEdgeSourceKey, partWorldEdges, type PartEdgeSource } from './partWorldEdges';

type Vec3 = [number, number, number];

/** An edge of a part behind an open sketch, laid onto the sketch's plane in its own mm, y up. */
export interface PartEdge extends PartEdgeSource {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Whether the edge lies in the sketch's plane, rather than being seen through it. */
  onPlane: boolean;
  /** Equally eligible projected segments from different physical sources cannot be distinguished by a click. */
  ambiguous?: boolean;
}

/** How far an edge may be off the plane and still be in it, in mm. */
const kOnPlane = 1e-3;

const round = (value: number) => Math.round(value * 1000) / 1000 || 0;

/**
 * The parts' edges as a sketch on a plane sees them: each laid straight onto the plane, as the reference's Use takes
 * them. Edges seen end-on, which land on a point, are left out.
 */
export function partEdgesOnPlane(
  meshes: BodyMesh[],
  frame: { origin: Vec3; x: Vec3; y: Vec3; normal: Vec3 },
  instances?: readonly PartEdgeSource[]
): PartEdge[] {
  const origin = new THREE.Vector3(...frame.origin),
    x = new THREE.Vector3(...frame.x),
    y = new THREE.Vector3(...frame.y),
    normal = new THREE.Vector3(...frame.normal);
  const edges = new Map<string, Map<string, PartEdge>>();
  const a = new THREE.Vector3(),
    b = new THREE.Vector3();
  for (const edge of partWorldEdges(meshes, instances)) {
    a.fromArray(edge.a).sub(origin);
    b.fromArray(edge.b).sub(origin);
    const [x1, y1, x2, y2] = [a.dot(x), a.dot(y), b.dot(x), b.dot(y)].map(round) as [number, number, number, number];
    if (x1 === x2 && y1 === y2) continue;
    const onPlane = Math.abs(a.dot(normal)) < kOnPlane && Math.abs(b.dot(normal)) < kOnPlane;
    // Preserve in-plane priority. Equally eligible top/underside duplicates may merge within one physical owner;
    // another owner requires an explicit ambiguous-source refusal rather than an arbitrary association.
    const ends = [`${x1},${y1}`, `${x2},${y2}`].sort();
    const key = `${ends[0]} ${ends[1]}`;
    let known = edges.get(key);
    const previous = known?.values().next().value;
    if (previous?.onPlane && !onPlane) continue;
    if (!known || (onPlane && !previous?.onPlane)) edges.set(key, (known = new Map()));
    known.set(partEdgeSourceKey(edge), { key, partId: edge.partId, ...(edge.copyId && { copyId: edge.copyId }), x1, y1, x2, y2, onPlane });
  }
  return [...edges.entries()].map(([key, sources]) => ({
    ...sources.values().next().value!,
    key: JSON.stringify([key, ...[...sources.keys()].sort()]),
    ...(sources.size > 1 && { ambiguous: true }),
  }));
}
