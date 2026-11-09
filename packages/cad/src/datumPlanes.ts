import { cadFaceFrame } from './drawnOn';
import type { CadDocument } from './types';

type Vec3 = [number, number, number];

/** Where a datum plane is: its origin, axes and normal in the studio, or null when what it's on is gone. */
export function cadDatumFrame(document: CadDocument, planeId: string): { origin: Vec3; x: Vec3; y: Vec3; normal: Vec3 } | null {
  const plane = document.planes?.find(candidate => candidate.id === planeId);
  if (!plane) return null;
  const frame = cadFaceFrame(document, plane.on);
  if ('error' in frame) return null;
  return { ...frame, origin: frame.origin.map((value, axis) => value + frame.normal[axis]! * plane.offset) as Vec3 };
}

/**
 * Parts drawn on a datum plane take their plane or face, and the offset to it, from that plane as it is now, so they
 * follow it when it's changed. A part whose datum plane is gone keeps where it was.
 */
export function resolveDatumPlanes(document: CadDocument): CadDocument {
  if (!document.planes?.length || !document.parts.some(part => part.drawnOn?.datum)) return document;
  let changed = false;
  const parts = document.parts.map(part => {
    const datum = part.drawnOn?.datum && document.planes!.find(plane => plane.id === part.drawnOn!.datum);
    if (!datum) return part;
    if (JSON.stringify(part.drawnOn!.on) === JSON.stringify(datum.on) && part.drawnOn!.offset === datum.offset) return part;
    changed = true;
    const drawnOn = { ...part.drawnOn!, on: datum.on, offset: datum.offset };
    delete drawnOn.offsetExpression;
    return { ...part, drawnOn };
  });
  return changed ? { ...document, parts } : document;
}

/** A new datum plane's name: Plane 1, Plane 2, … */
export const nextDatumName = (document: CadDocument) => `Plane ${(document.planes?.length ?? 0) + 1}`;

/** Deletes a datum plane. Parts drawn on it stay where they are, on what it was offset from. */
export function removeDatumPlane(document: CadDocument, planeId: string): CadDocument {
  const parts = resolveDatumPlanes(document).parts.map(part => {
    let next = part;
    // Up to a plane that's gone: up to what it was offset from.
    if (part.upToDatum === planeId) {
      next = { ...next };
      delete next.upToDatum;
    }
    if (part.drawnOn?.datum !== planeId) return next;
    const drawnOn = { ...part.drawnOn };
    delete drawnOn.datum;
    return { ...next, drawnOn };
  });
  const planes = document.planes?.filter(plane => plane.id !== planeId);
  return { ...document, revision: document.revision + 1, parts, ...(planes?.length ? { planes } : { planes: undefined }) };
}
