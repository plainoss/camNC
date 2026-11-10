import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import type { BodyMesh } from '../camTypes';

export interface FacePlane {
  point: [number, number, number];
  normal: [number, number, number];
}

/** Copy only triangles on the picked plane, preserving holes and clipped boundaries in the displayed mesh. */
export function faceHighlightGeometry(mesh: Pick<BodyMesh, 'positions' | 'indices'>, face: FacePlane): BufferGeometry {
  const vertices: number[] = [],
    a = new Vector3(),
    b = new Vector3(),
    c = new Vector3(),
    n = new Vector3();
  const normal = new Vector3(...face.normal).normalize(),
    at = new Vector3(...face.point);
  for (let i = 0; i < mesh.indices.length; i += 3) {
    a.fromArray(mesh.positions, mesh.indices[i]! * 3);
    b.fromArray(mesh.positions, mesh.indices[i + 1]! * 3);
    c.fromArray(mesh.positions, mesh.indices[i + 2]! * 3);
    n.subVectors(b, a).cross(new Vector3().subVectors(c, a)).normalize();
    if (n.dot(normal) < 1 - 1e-6 || [a, b, c].some(p => Math.abs(new Vector3().subVectors(p, at).dot(normal)) > 1e-3)) continue;
    vertices.push(...a.toArray(), ...b.toArray(), ...c.toArray());
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  return geometry;
}

export function sameFacePlane(a: FacePlane, b: FacePlane): boolean {
  const normal = new Vector3(...a.normal).normalize();
  return (
    normal.dot(new Vector3(...b.normal).normalize()) > 1 - 1e-6 &&
    Math.abs(new Vector3(...a.point).sub(new Vector3(...b.point)).dot(normal)) < 1e-3
  );
}
