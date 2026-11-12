import { holeSketch, type CadDocument, type CadPart } from '@wbcnc/cad';
import { asHole, replacePart } from './editorHelpers';

/**
 * The step the Hole command works on for the selected part. A sketch is made a hole itself, and a Hole step is opened
 * again. A board is drilled, never made the hole: the newest sketch with points on one of its faces becomes the Hole.
 * Anything else is refused with what to do instead.
 */
export function holeSource(document: CadDocument, part: CadPart): { partId: string; convert: boolean } | { refusal: string } {
  if (part.hole) return { partId: part.id, convert: false };
  if (part.extrude === false) return { partId: part.id, convert: true };
  if (part.remove || part.addTo !== undefined)
    return { refusal: 'Hole drills into a board. Select the board, or a sketch with points on its face.' };
  const sketch = document.parts.findLast(
    candidate =>
      candidate.extrude === false &&
      !candidate.suppressed &&
      candidate.drawnOn !== undefined &&
      'partId' in candidate.drawnOn.on &&
      candidate.drawnOn.on.partId === part.id &&
      holeSketch({ ...candidate, hole: { diameter: 1 } }).entities.length > 0
  );
  if (!sketch)
    return { refusal: `Hole drills at the points of a sketch on ${part.name}. Sketch points on one of its faces, then choose Hole.` };
  return { partId: sketch.id, convert: true };
}

/** Run the Hole command on the selected part: open the Hole step it drills with, or say why there is none. */
export function startHole(
  document: CadDocument,
  part: CadPart,
  commit: (next: CadDocument) => void,
  open: (partId: string, before: CadDocument) => void,
  refuse: (message: string) => void
) {
  const source = holeSource(document, part);
  if ('refusal' in source) return refuse(source.refusal);
  if (source.convert) commit(replacePart(document, source.partId, asHole));
  open(source.partId, document);
}
