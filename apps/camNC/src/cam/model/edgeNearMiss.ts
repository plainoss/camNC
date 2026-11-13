import type * as THREE from 'three';
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
): { index: number; edge: ModelEdge } | null {
  let best: { index: number; edge: ModelEdge; distance: number } | null = null;
  for (const [index, { positions, indices, matrix }] of bodies.entries()) {
    if (!indices.length) continue;
    const screen = screenDistance(camera, matrix, canvas.width, canvas.height, pointer);
    const edge = nearestEdgeBy(positions, indices, screen.segment, tolerance);
    const distance = edge ? screen.segment(edge.a, edge.b) : Infinity;
    if (edge && (!best || distance < best.distance)) best = { index, edge, distance };
  }
  return best && { index: best.index, edge: best.edge };
}
