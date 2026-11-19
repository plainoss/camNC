import type { ViewRequest } from './ViewCameras';

/** Where each named view looks from, Z up: Front from −Y, Top from +Z, Isometric from the front right, above. */
export const kViewDirections = {
  front: [0, -1, 0],
  back: [0, 1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  iso: [0.2, -0.75, 1],
} satisfies Record<Exclude<ViewRequest['name'], 'fit' | 'normal'>, [number, number, number]>;
