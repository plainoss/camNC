import { cadDatumFrame, type CadDocument, type CadDrawnOn } from '@wbcnc/cad';
import { physicalFaceFrame as cadFaceFrame } from './studioGeometryReaders';
import type { ViewPlane } from '@/cam/model/ModelViewport';

/** The design's base planes, which every sketch can be drawn on. */
export type BasePlane = 'top' | 'front' | 'right';

export const kBasePlanes: { plane: BasePlane; label: string }[] = [
  { plane: 'top', label: 'Top' },
  { plane: 'front', label: 'Front' },
  { plane: 'right', label: 'Right' },
];

export const isBasePlane = (id: string): id is BasePlane => kBasePlanes.some(({ plane }) => plane === id);

/**
 * A plane picked in the feature list or the view, by its id: a base plane, or one of the design's planes, which is
 * drawn on as what it's offset from, that far out.
 */
export function pickedPlane(document: CadDocument, id: string): { on: CadDrawnOn['on']; datum?: string; name: string } | null {
  const base = kBasePlanes.find(({ plane }) => plane === id);
  if (base) return { on: { plane: base.plane }, name: `the ${base.plane} plane` };
  const datum = document.planes?.find(plane => plane.id === id);
  return datum ? { on: datum.on, datum: datum.id, name: datum.name } : null;
}

/** Where a picked plane is, for looking straight at it. */
export function pickedPlaneFrame(document: CadDocument, id: string) {
  if (isBasePlane(id)) {
    const frame = cadFaceFrame(document, { plane: id });
    return 'error' in frame ? null : frame;
  }
  return cadDatumFrame(document, id);
}

/** The base planes and the design's own planes as the 3D view shows them, the picked one drawn stronger. */
export function basePlaneViews(document: CadDocument, picked?: string | null): ViewPlane[] {
  return [
    ...kBasePlanes.map(({ plane, label }) => ({ id: plane as string, label })),
    ...(document.planes ?? []).map(plane => ({ id: plane.id, label: plane.name })),
  ].flatMap(({ id, label }) => {
    const frame = pickedPlaneFrame(document, id);
    return frame ? [{ id, label, origin: frame.origin, x: frame.x, y: frame.y, normal: frame.normal, highlighted: picked === id }] : [];
  });
}

/** What a new plane is offset from when one is picked first: a base plane, or a part's face that's still there. */
export function planeOffsetFrom(
  document: CadDocument,
  selectedPlane: string | null,
  selectedFace: Extract<CadDrawnOn['on'], { partId: string }> | null
): CadDrawnOn['on'] | null {
  const plane = selectedPlane && pickedPlane(document, selectedPlane);
  const face = selectedFace && cadFaceFrame(document, selectedFace);
  return plane && !plane.datum ? plane.on : face && !('error' in face) ? selectedFace : null;
}
