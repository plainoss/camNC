import { BoxGeometry, Mesh, type Object3D } from 'three';

/** The box geometry's −Y face (px, nx, py, ny, pz, nz), the cube's Bottom once turned into the model's Z-up frame. */
const kBottomFace = 3;

/**
 * Turn the view cube's BOTTOM label half a turn, so it reads upright in Bottom view.
 *
 * Bottom view keeps the camera's up at +Y, which puts +X on the left of the screen, while the cube lays the label out
 * with +X to the right. Turning the camera instead would change the underside sketch frame that Bottom view matches
 * (`drawnOn`, `sketchFromCamera`, N on an underside face, the section's normal view), so only the label turns (#698).
 */
export function turnViewCubeBottomLabel(root: Object3D) {
  root.traverse(object => {
    if (!(object instanceof Mesh) || !Array.isArray(object.material) || !(object.geometry instanceof BoxGeometry)) return;
    const geometry = object.geometry;
    // Effects can run twice for one geometry (React's strict mode); turning it again would undo the first turn.
    if (geometry.userData.bottomLabelTurned) return;
    const group = geometry.groups[kBottomFace];
    const uv = geometry.getAttribute('uv');
    const index = geometry.getIndex();
    if (!group || !uv || !index) return;
    const vertices = new Set<number>();
    for (let i = group.start; i < group.start + group.count; i++) vertices.add(index.getX(i));
    for (const vertex of vertices) uv.setXY(vertex, 1 - uv.getX(vertex), 1 - uv.getY(vertex));
    uv.needsUpdate = true;
    geometry.userData.bottomLabelTurned = true;
  });
}
