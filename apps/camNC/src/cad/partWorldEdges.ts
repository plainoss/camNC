import { BufferAttribute, BufferGeometry, EdgesGeometry } from 'three';
import type { BodyMesh } from '@/cam/camTypes';

/** A physical source, independent of the family's shared mesh partId. */
export interface PartEdgeSource {
  partId: string;
  copyId?: string;
}
export interface PartWorldEdge extends PartEdgeSource {
  a: [number, number, number];
  b: [number, number, number];
}
export const partEdgeSourceKey = (source: PartEdgeSource) => JSON.stringify([source.partId, source.copyId ?? null]);

/** Visible crease edges carry the corresponding physical instance before projection can merge their coordinates. */
export function partWorldEdges(meshes: readonly BodyMesh[], instances?: readonly PartEdgeSource[]): PartWorldEdge[] {
  const edges: PartWorldEdge[] = [];
  for (const [index, mesh] of meshes.entries()) {
    const source = instances ? instances[index] : { partId: mesh.partId };
    if (!source) continue;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
    geometry.setIndex(new BufferAttribute(mesh.indices, 1));
    // Facets on curved faces are not additional user-facing crease edges.
    const lines = new EdgesGeometry(geometry, 20),
      positions = lines.getAttribute('position');
    for (let at = 0; at < positions.count; at += 2)
      edges.push({
        partId: source.partId,
        ...(source.copyId && { copyId: source.copyId }),
        a: [positions.getX(at), positions.getY(at), positions.getZ(at)],
        b: [positions.getX(at + 1), positions.getY(at + 1), positions.getZ(at + 1)],
      });
    lines.dispose();
    geometry.dispose();
  }
  return edges;
}
