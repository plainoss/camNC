import { cadFaceFrame, type CadDocument, type CadDrawnOn, type CadPart } from '@wbcnc/cad';
import type { ViewRequest } from '@/cam/model/ModelViewport';
import { pickedPlaneFrame } from './basePlanes';
import { physicalFaceFrame } from './studioGeometryReaders';

/** Inspect a selected physical face; a part's own sketch keeps its pre-operation generation frame. */
export function studioNormalView(
  document: CadDocument,
  selectedPlane: string | null,
  selectedFace: Extract<CadDrawnOn['on'], { partId: string }> | null,
  part?: CadPart
) {
  const frame = selectedPlane
    ? pickedPlaneFrame(document, selectedPlane)
    : selectedFace
      ? physicalFaceFrame(document, selectedFace)
      : part && cadFaceFrame(document, part.drawnOn?.on ?? { plane: 'top' });
  if (!frame || 'error' in frame) return null;
  return (previous: ViewRequest | undefined): ViewRequest => {
    const same = previous?.name === 'normal' && previous.direction?.every((value, axis) => Math.abs(value - frame.normal[axis]!) < 1e-9);
    return {
      name: 'normal',
      seq: (previous?.seq ?? 0) + 1,
      direction: same ? (frame.normal.map(value => -value) as [number, number, number]) : frame.normal,
      up: frame.y,
    };
  };
}
