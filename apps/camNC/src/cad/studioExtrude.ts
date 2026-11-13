import {
  CAD_CHORD_TOLERANCE,
  evaluateCadPart,
  faceExtrudeProblem,
  newExtrudeOf,
  newExtrudeOnFace,
  sketchRegions,
  type CadDocument,
  type CadDrawnOn,
  type CadPart,
} from '@wbcnc/cad';
import { extrudedSketch, isSingleLine, replacePart, wholeSketch } from './editorHelpers';

/** A new board's thickness when nothing else sets it, as a new sketch's part has. */
export const kDefaultThickness = 18;

type PickedFace = Extract<CadDrawnOn['on'], { partId: string }>;

/** The design with a new Extrude in it, and the step its dialog edits, or why it can't start. */
export type StartedExtrude = { document: CadDocument; partId: string } | { refusal: string };

/**
 * Starts the studio's Extrude: of a picked face, of a sketch not extruded yet (making a part of it), or as another
 * extrude of a part's sketch. `pickAll` starts it with every region of the sketch, as when it's picked from its row or
 * extruded straight from the open sketch; otherwise a sketch's first extrude starts with none picked. `pickedProfile`
 * applies a region picked in the view.
 */
export function startExtrude(
  before: CadDocument,
  from: { face: PickedFace } | { part: CadPart },
  pickAll: boolean,
  pickedProfile: (part: CadPart) => CadPart
): StartedExtrude {
  if ('face' in from) {
    const problem = faceExtrudeProblem(before, from.face);
    if (problem) return { refusal: problem };
    const made = newExtrudeOnFace(before, from.face, `Part ${before.parts.length + 1}`);
    if (!evaluateCadPart(made).part) return { refusal: 'Pick a planar face that can be extruded.' };
    return { document: { ...before, revision: before.revision + 1, parts: [...before.parts, made] }, partId: made.id };
  }
  const { part } = from;
  if (part.extrude === false) {
    // Extruding a sketch makes a part of it; cancelling leaves the sketch as it was. One line is a board edge-on.
    // A sketch that can't be a part as a whole can still have a region picked from it; with none, it says why.
    const problem =
      !(part.drawnOn && isSingleLine(part)) &&
      !sketchRegions(part.sketch, CAD_CHORD_TOLERANCE).length &&
      evaluateCadPart(part).diagnostics.find(diagnostic => diagnostic.severity === 'error');
    if (problem) return { refusal: `Can’t extrude this sketch yet: ${problem.message}` };
    // Unless all of it is asked for, nothing is picked yet: its regions are picked in the view, the selection active.
    const started = (p: CadPart) => {
      const made = extrudedSketch(before, p, pickAll);
      return pickAll || made.thin || made.regions ? made : { ...made, regions: [] };
    };
    return { document: replacePart(before, part.id, p => pickedProfile(started(p))), partId: part.id };
  }
  // Extrude always starts a new extrude, of the part's sketch here: with all of it when asked, otherwise with none
  // picked and the default thickness rather than the last one used, unless that follows a variable. An extrude already
  // made is edited from its step.
  const next = newExtrudeOf(before, part, `Part ${before.parts.length + 1}`);
  const fresh = { ...next, regions: [], ...(!next.thicknessExpression && { thickness: kDefaultThickness }) };
  const made = pickedProfile(pickAll ? wholeSketch(next) : fresh);
  return { document: { ...before, revision: before.revision + 1, parts: [...before.parts, made] }, partId: made.id };
}
