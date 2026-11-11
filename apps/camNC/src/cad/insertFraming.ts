import { assemblyReport, evaluateCadDocument, type CadDocument } from '@wbcnc/cad';
import type { ViewRequest } from '@/cam/model/ModelViewport';
import type { StudioCameraState } from './studioCamera';
import { listedStudioParts } from './studioParts';

type Box = { at: readonly number[]; size: readonly number[] };

function placedBoxes(document: CadDocument): Box[] {
  return assemblyReport(document, evaluateCadDocument(document).parts)?.parts ?? [];
}

/**
 * Whether applying `after` over `before` should fit the view to the whole design, as F does. Only a change that adds
 * parts can: into a design with nothing listed yet, always, since there is no framing to keep; otherwise only when a
 * new part would sit outside the current view, so a view framed on purpose stays put when the new parts are in sight.
 */
export function framesInsert(before: CadDocument, after: CadDocument, camera: StudioCameraState | null): boolean {
  const known = new Set(before.parts.map(part => part.id));
  if (after.parts.every(part => known.has(part.id))) return false;
  if (!listedStudioParts(before).length) return true;
  // Untouched parts keep their exact box; whatever box is new belongs to an added (or moved) part.
  const old = placedBoxes(before).map(box => JSON.stringify(box));
  const added = placedBoxes(after).filter(box => {
    const index = old.indexOf(JSON.stringify(box));
    if (index < 0) return true;
    old.splice(index, 1);
    return false;
  });
  if (!added.length) return false;
  // Without a known assembled view (none drawn yet, or the exploded view moves parts), fitting is the safe choice.
  if (!camera?.aspect || (camera.key !== undefined && camera.key !== 'assembled')) return true;
  const [bx, by, bz] = camera.back;
  const [ux, uy, uz] = camera.up;
  // The view's right is up × back; the view is orthographic, so depth along back doesn't matter.
  const right = [uy * bz - uz * by, uz * bx - ux * bz, ux * by - uy * bx];
  const halfHeight = camera.height / 2,
    halfWidth = halfHeight * camera.aspect;
  return added.some(({ at, size }) =>
    [0, 1].some(i =>
      [0, 1].some(j =>
        [0, 1].some(k => {
          const corner = [at[0]! + i * size[0]!, at[1]! + j * size[1]!, at[2]! + k * size[2]!].map(
            (value, axis) => value - camera.center[axis]!
          );
          const dot = (axis: readonly number[]) => corner.reduce((sum, value, n) => sum + value * axis[n]!, 0);
          return Math.abs(dot(right)) > halfWidth || Math.abs(dot(camera.up)) > halfHeight;
        })
      )
    )
  );
}

/** Apply a reviewed change, then fit the view to the design when `framesInsert` says the change needs it. */
export function applyFramed(
  before: CadDocument,
  after: CadDocument,
  camera: StudioCameraState | null,
  apply: (document: CadDocument) => void,
  request: (update: (previous: ViewRequest | undefined) => ViewRequest) => void
) {
  apply(after);
  if (framesInsert(before, after, camera)) request(previous => ({ name: 'fit', seq: (previous?.seq ?? 0) + 1 }));
}
