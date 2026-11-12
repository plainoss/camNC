import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { turnViewCubeBottomLabel } from './viewCubeBottomLabel';

/** The view cube's face mesh as drei builds it, in the Y-up group ViewCube turns into the model's Z-up frame. */
function cube() {
  const face = new Mesh(
    new BoxGeometry(),
    Array.from({ length: 6 }, () => new MeshBasicMaterial())
  );
  const edge = new Mesh(new BoxGeometry(0.5, 0.25, 0.25), new MeshBasicMaterial());
  const group = new Group();
  group.rotation.set(Math.PI / 2, 0, 0);
  group.add(face, edge);
  group.updateMatrixWorld();
  return { group, face, edge };
}

/** Which way the BOTTOM label's own right and up point on screen in Bottom view: from −Z, camera up at +Y. */
function labelOnScreen(face: Mesh) {
  const camera = new PerspectiveCamera();
  camera.position.set(0, 0, -5);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const geometry = face.geometry;
  const { start, count } = geometry.groups[3]!;
  const vertices = [...new Set(Array.from({ length: count }, (_, i) => geometry.getIndex()!.getX(start + i)))];
  const uv = geometry.getAttribute('uv');
  const screen = (vertex: number) =>
    new Vector3().fromBufferAttribute(geometry.getAttribute('position'), vertex).applyMatrix4(face.matrixWorld).project(camera);
  const along = (axis: 'x' | 'y', get: (vertex: number) => number) => {
    const sorted = [...vertices].sort((a, b) => get(a) - get(b));
    return Math.sign(screen(sorted.at(-1)!)[axis] - screen(sorted[0]!)[axis]);
  };
  return {
    right: along('x', vertex => uv.getX(vertex) + uv.getY(vertex) * 1e-3),
    up: along('y', vertex => uv.getY(vertex) + uv.getX(vertex) * 1e-3),
  };
}

it('reads the BOTTOM label upright in Bottom view (#698)', () => {
  const { group, face } = cube();
  // As drei lays it out, the label is turned half a turn from below.
  expect(labelOnScreen(face)).toEqual({ right: -1, up: -1 });
  turnViewCubeBottomLabel(group);
  expect(labelOnScreen(face)).toEqual({ right: 1, up: 1 });
});

it('turns the label once, and leaves the other faces and the edge handles alone', () => {
  const { group, face, edge } = cube();
  const uvs = (mesh: Mesh) => Array.from(mesh.geometry.getAttribute('uv').array);
  const before = { face: uvs(face), edge: uvs(edge) };
  turnViewCubeBottomLabel(group);
  turnViewCubeBottomLabel(group);
  expect(labelOnScreen(face)).toEqual({ right: 1, up: 1 });
  expect(uvs(edge)).toEqual(before.edge);
  // Four vertices of two floats each per face: only the fourth face's changed.
  const changed = uvs(face).flatMap((value, i) => (value === before.face[i] ? [] : [Math.floor(i / 8)]));
  expect(new Set(changed)).toEqual(new Set([3]));
});
