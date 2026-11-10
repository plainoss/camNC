import { Vector3, type Box3, type Object3D, type Raycaster } from 'three';

/** Marks geometry that can supply the point about which the model turns. */
export const kOrbitSurface = { orbitSurface: true };

const onPlane = (object: Object3D | null): boolean => !!object && (object.userData.plane === true || onPlane(object.parent));

export function pickOrbitPivot(raycaster: Raycaster, scene: Object3D, box: Box3): Vector3 | null {
  const surfaces: Object3D[] = [];
  scene.traverseVisible(object => {
    if (object.userData.orbitSurface) surfaces.push(object);
  });
  const hits = raycaster.intersectObjects(surfaces, true);
  // Reference planes give way to actual model geometry, just as they do for face picking.
  const hit = hits.find(candidate => !onPlane(candidate.object)) ?? hits[0];
  return hit ? hit.point.clone() : box.isEmpty() ? null : box.getCenter(new Vector3());
}
