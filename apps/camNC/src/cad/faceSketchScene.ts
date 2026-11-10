import {
  cadFaceFrame,
  evaluateCadPart,
  evaluateCadFeatures,
  faceIsUnderside,
  featuresForCopy,
  resolveDrawnPlacements,
  effectivePlacement,
  cadDrawnOnSupports,
  placePoint,
  rotateVector,
  type CadDocument,
  type CadFaceRef,
} from '@wbcnc/cad';
import { sketchFromCamera, type StudioCameraRef } from './studioCamera';

export interface PartViewSnapshot {
  cameraState: StudioCameraRef;
  aspect: number;
}
export interface FaceSketchScene extends PartViewSnapshot {
  document: CadDocument;
  partId: string;
  copyId?: string;
  frame: Exclude<ReturnType<typeof cadFaceFrame>, { error: string }>;
}

/** Carry a local per-part camera into the assembly before starting a side-face profile. */
export function assemblyCameraFromPart(document: CadDocument, partId: string, snapshot: PartViewSnapshot) {
  const camera = snapshot.cameraState.current;
  if (!camera) return null;
  const placed = resolveDrawnPlacements(document).document;
  const part = placed.parts.find(part => part.id === partId);
  const placement = part && effectivePlacement(part, cadDrawnOnSupports(placed));
  if (!placement) return { ...camera, key: 'assembled' };
  return {
    ...camera,
    key: 'assembled',
    center: placePoint(placement, camera.center),
    back: rotateVector(placement.rotation, camera.back),
    up: rotateVector(placement.rotation, camera.up),
  };
}

/** The per-part view uses the part's local cutting coordinates, even when it is placed in an assembly. */
export function faceSketchScene(
  document: CadDocument,
  partId: string,
  face: CadFaceRef,
  view: PartViewSnapshot,
  copyId?: string
): FaceSketchScene | undefined {
  const part = document.parts.find(part => part.id === partId);
  if (!part) return;
  const local = { ...part, placement: undefined, drawnOn: undefined };
  const below = faceIsUnderside(part, face);
  const frame = cadFaceFrame({ ...document, parts: [local] }, { partId, face: below ? 'underside' : 'top' });
  if ('error' in frame) return;
  if (typeof face === 'object') {
    const profile = evaluateCadPart(part).part;
    const source = part.features?.find(feature => feature.type === 'cut' && feature.id === face.floorOf);
    // A copy can override the family's parent cut while a child sketch keeps its saved family floor reference.
    const projected =
      source?.type === 'cut' &&
      featuresForCopy(part, copyId).find(
        feature => feature.type === 'cut' && feature.sketchId === source.sketchId && feature.regionId === source.regionId
      );
    const floorId = projected ? projected.id : face.floorOf;
    const floor = profile && evaluateCadFeatures(part, profile, copyId).part.cuts?.find(cut => cut.id === floorId);
    if (!floor || floor.through) return;
    frame.origin = frame.origin.map((value, axis) => value - frame.normal[axis]! * floor.to) as [number, number, number];
  }
  return { ...view, document, partId, ...(copyId && { copyId }), frame };
}

export function initialFaceSketchView(scene?: FaceSketchScene) {
  return scene?.cameraState.current ? sketchFromCamera(scene.cameraState.current, scene.frame, scene.aspect) : null;
}

export function partViewSnapshot(cameraState: StudioCameraRef, root: HTMLElement | null, enabled: boolean): PartViewSnapshot | undefined {
  const bounds = enabled && root?.querySelector('[data-testid="part-3d"] canvas')?.getBoundingClientRect();
  return bounds && bounds.height && cameraState.current ? { cameraState, aspect: bounds.width / bounds.height } : undefined;
}
