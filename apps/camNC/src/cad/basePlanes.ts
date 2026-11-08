import { cadFaceFrame, type CadDocument } from '@wbcnc/cad';
import type { ViewPlane } from '@/cam/model/ModelViewport';

/** The design's base planes, which every sketch can be drawn on. */
export type BasePlane = 'top' | 'front' | 'right';

export const kBasePlanes: { plane: BasePlane; label: string }[] = [
  { plane: 'top', label: 'Top' },
  { plane: 'front', label: 'Front' },
  { plane: 'right', label: 'Right' },
];

/** The base planes as the 3D view shows them, the picked one drawn stronger. */
export function basePlaneViews(document: CadDocument, picked?: BasePlane | null): ViewPlane[] {
  return kBasePlanes.flatMap(({ plane, label }) => {
    const frame = cadFaceFrame(document, { plane });
    return 'error' in frame
      ? []
      : [{ id: plane, label, origin: frame.origin, x: frame.x, y: frame.y, normal: frame.normal, highlighted: picked === plane }];
  });
}
