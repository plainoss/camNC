import { rotateVector, type CadPlacement } from '@wbcnc/cad';
import type { StudioCameraState } from './studioCamera';

/**
 * A face editor uses unreflected local sketch coordinates. A mirrored instance therefore reverses its horizontal
 * picture when entering those authored axes; keep its viewed location and side, rather than promising an improper camera.
 */
export function partCameraFromAssembly(camera: StudioCameraState, placement: CadPlacement, mirrored = false): StudioCameraState {
  const inverse: [number, number, number, number] = [
    -placement.rotation[0],
    -placement.rotation[1],
    -placement.rotation[2],
    placement.rotation[3],
  ];
  const local = (point: [number, number, number]) => {
    const value = rotateVector(inverse, point);
    return [mirrored ? -value[0] : value[0], value[1], value[2]] as [number, number, number];
  };
  return {
    ...camera,
    center: local(camera.center.map((value, axis) => value - placement.position[axis]!) as [number, number, number]),
    back: local(camera.back),
    up: local(camera.up),
  };
}
