import type * as THREE from 'three';

/** Marks a plane's mesh, so picking can tell planes from what's drawn. */
export const kPlaneMarker = { plane: true };

const isPlane = (object: THREE.Object3D | null): boolean => !!object && (object.userData.plane === true || isPlane(object.parent));

/**
 * Whether a plane under the pointer gives way to something else there: a part's face, a region or a sketch line, even
 * one behind the plane, as that's what's being pointed at.
 */
export const planeGivesWay = (hits: readonly { object: THREE.Object3D }[]) =>
  hits.some(hit => !isPlane(hit.object) && (hit.object as THREE.Mesh).isMesh);
