import * as THREE from 'three';
import { nearestEdgeBy, screenDistance, type ModelEdge } from './edgePick';

/**
 * The part edge nearest a click that missed every part, within `tolerance` pixels on screen: an edge seen edge-on, as
 * a board's front edge is from straight above, is still picked though the click lands just off the part.
 */
export function edgeNearMiss(
  camera: THREE.Camera,
  bodies: readonly { positions: Float32Array; indices: ArrayLike<number>; matrix: THREE.Matrix4 }[],
  canvas: { width: number; height: number },
  pointer: { x: number; y: number },
  tolerance: number
): { index: number; edge: ModelEdge; normal: [number, number, number] } | null {
  let best: { index: number; edge: ModelEdge; distance: number } | null = null;
  for (const [index, { positions, indices, matrix }] of bodies.entries()) {
    if (!indices.length) continue;
    const screen = screenDistance(camera, matrix, canvas.width, canvas.height, pointer);
    const edge = nearestEdgeBy(positions, indices, screen.segment, tolerance);
    const distance = edge ? screen.segment(edge.a, edge.b) : Infinity;
    if (edge && (!best || distance < best.distance)) best = { index, edge, distance };
  }
  if (!best) return null;
  const { positions, indices, matrix } = bodies[best.index]!;
  return { index: best.index, edge: best.edge, normal: facingNormal(camera, positions, indices, matrix, best.edge) };
}

/** The normal of the face beside an edge that faces the camera, in the body's own frame: the face the edge is seen on. */
function facingNormal(
  camera: THREE.Camera,
  positions: Float32Array,
  indices: ArrayLike<number>,
  matrix: THREE.Matrix4,
  edge: ModelEdge
): [number, number, number] {
  const at = (i: number) => new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
  const a = new THREE.Vector3(...edge.a),
    b = new THREE.Vector3(...edge.b);
  const view = camera.getWorldDirection(new THREE.Vector3());
  const turn = new THREE.Matrix3().getNormalMatrix(matrix);
  let best: THREE.Vector3 | null = null,
    facing = 0;
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const [p, q, r] = [at(indices[t]!), at(indices[t + 1]!), at(indices[t + 2]!)];
    const on = (point: THREE.Vector3) => [p, q, r].some(corner => corner.distanceTo(point) < 1e-6);
    if (!on(a) || !on(b)) continue;
    const normal = new THREE.Vector3().subVectors(q, p).cross(new THREE.Vector3().subVectors(r, p)).normalize();
    const toward = -normal.clone().applyMatrix3(turn).normalize().dot(view);
    if (!best || toward > facing) [best, facing] = [normal, toward];
  }
  return best ? (best.toArray() as [number, number, number]) : [0, 0, 1];
}
