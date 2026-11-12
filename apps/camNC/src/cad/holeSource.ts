import { holeSketch, rolledBackTo, type CadDocument, type CadPart } from '@wbcnc/cad';
import { asHole, replacePart } from './editorHelpers';

export interface HolePick {
  /** The part selected in Parts or the view, if any. */
  partId?: string;
  /** The copy picked in the view, as the selection holds it. Any copy, even one gone, is refused, not drilled as its family. */
  copyId?: string;
  /** The step the user rolled the design back to: sketches below the bar aren't there to drill with. */
  rolledTo?: string | null;
}

const hasPoints = (sketch: CadPart) => holeSketch({ ...sketch, hole: { diameter: 1 } }).entities.length > 0;

/** A sketch Hole can drill with into `board`: points on its top or underside, not on a copy's face. */
function drillsInto(sketch: CadPart, board: CadPart): boolean {
  const on = sketch.drawnOn?.on;
  return (
    sketch.extrude === false &&
    !!on &&
    'partId' in on &&
    on.partId === board.id &&
    !on.copyId &&
    (on.face === 'top' || on.face === 'underside') &&
    hasPoints(sketch)
  );
}

/**
 * The step the Hole command works on for the selected part. A sketch is made a hole itself, and a Hole step is opened
 * again. A board is drilled, never made the hole: the newest sketch with points on its top or underside, above the
 * rollback bar, becomes the Hole. Anything else is refused with what to do instead.
 */
export function holeSource(document: CadDocument, pick: HolePick): { partId: string; convert: boolean } | { refusal: string } {
  if (pick.copyId !== undefined)
    return { refusal: 'Drilling only the selected copy is not supported. Select the source part in Parts to drill its whole family.' };
  const part = pick.partId === undefined ? undefined : document.parts.find(candidate => candidate.id === pick.partId);
  if (!part) return { refusal: 'Select a board, or a sketch with points on its face, then choose Hole.' };
  if (part.hole) return { partId: part.id, convert: false };
  if (part.extrude === false) return { partId: part.id, convert: true };
  if (part.remove || part.addTo !== undefined)
    return { refusal: 'Hole drills into a board. Select the board, or a sketch with points on its face.' };
  const shown = pick.rolledTo ? new Set(rolledBackTo(document, pick.rolledTo).parts.map(candidate => candidate.id)) : null;
  const sketches = document.parts.filter(candidate => (!shown || shown.has(candidate.id)) && drillsInto(candidate, part));
  const sketch = sketches.findLast(candidate => !candidate.suppressed);
  if (sketch) return { partId: sketch.id, convert: true };
  const suppressed = sketches.at(-1);
  if (suppressed)
    return { refusal: `The points sketch on ${part.name}, ${suppressed.name}, is suppressed. Unsuppress it, then choose Hole.` };
  return { refusal: `Hole drills at the points of a sketch on ${part.name}. Sketch points on its top or underside, then choose Hole.` };
}

/**
 * Run the Hole command on the selected part: open the Hole step it drills with, or say why there is none. A step dialog
 * still open is cancelled first, as its Cancel does, so Hole starts from the design that leaves.
 */
export function startHole({
  cancel,
  read,
  commit,
  open,
  refuse,
  ...pick
}: HolePick & {
  cancel: () => unknown;
  read: () => CadDocument;
  commit: (next: CadDocument) => void;
  open: (kind: 'hole', partId: string, before: CadDocument) => void;
  refuse: (message: string) => void;
}) {
  if (pick.copyId === undefined) cancel();
  const document = read();
  const source = holeSource(document, pick);
  if ('refusal' in source) return refuse(source.refusal);
  if (source.convert) commit(replacePart(document, source.partId, asHole));
  open('hole', source.partId, document);
}
