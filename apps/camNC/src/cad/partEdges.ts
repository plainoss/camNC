import * as THREE from 'three';
import type { BodyMesh } from '@/cam/camTypes';

type Vec3 = [number, number, number];

/** An edge of a part behind an open sketch, laid onto the sketch's plane in its own mm, y up. */
export interface PartEdge {
  key: string;
  partId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Whether the edge lies in the sketch's plane, rather than being seen through it. */
  onPlane: boolean;
}

/** How far an edge may be off the plane and still be in it, in mm. */
const kOnPlane = 1e-3;
/** Faces meeting at less than this many degrees share no edge worth showing, as on a curve's facets. */
const kCrease = 20;

const round = (value: number) => Math.round(value * 1000) / 1000 || 0;

/**
 * The parts' edges as a sketch on a plane sees them: each laid straight onto the plane, as the reference's Use takes
 * them. Edges seen end-on, which land on a point, are left out.
 */
export function partEdgesOnPlane(meshes: BodyMesh[], frame: { origin: Vec3; x: Vec3; y: Vec3; normal: Vec3 }): PartEdge[] {
  const origin = new THREE.Vector3(...frame.origin),
    x = new THREE.Vector3(...frame.x),
    y = new THREE.Vector3(...frame.y),
    normal = new THREE.Vector3(...frame.normal);
  const edges = new Map<string, PartEdge>();
  const a = new THREE.Vector3(),
    b = new THREE.Vector3();
  for (const mesh of meshes) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    const lines = new THREE.EdgesGeometry(geometry, kCrease).getAttribute('position');
    for (let i = 0; i < lines.count; i += 2) {
      a.fromBufferAttribute(lines, i).sub(origin);
      b.fromBufferAttribute(lines, i + 1).sub(origin);
      const [x1, y1, x2, y2] = [a.dot(x), a.dot(y), b.dot(x), b.dot(y)].map(round) as [number, number, number, number];
      if (x1 === x2 && y1 === y2) continue;
      const onPlane = Math.abs(a.dot(normal)) < kOnPlane && Math.abs(b.dot(normal)) < kOnPlane;
      // The same edge seen twice, as from both sides of a board or from two parts, is one edge; one in the plane wins.
      const ends = [`${x1},${y1}`, `${x2},${y2}`].sort();
      const key = `${ends[0]} ${ends[1]}`;
      const known = edges.get(key);
      if (!known || (onPlane && !known.onPlane)) edges.set(key, { key, partId: mesh.partId, x1, y1, x2, y2, onPlane });
    }
    geometry.dispose();
  }
  return [...edges.values()];
}
