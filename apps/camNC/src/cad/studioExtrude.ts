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
import { extrudedSketch, isSingleLine, replacePart } from './editorHelpers';

type PickedFace = Extract<CadDrawnOn['on'], { partId: string }>;

/** The design with a new Extrude in it, and the step its dialog edits, or why it can't start. */
export type StartedExtrude = { document: CadDocument; partId: string } | { refusal: string };

/**
 * Starts the studio's Extrude: of a picked face, of a sketch not extruded yet (making a part of it), or as another
 * extrude of a part's sketch. `pickAll` starts it with every region of the sketch, as when it's picked from its row or
 * extruded straight from the open sketch. `pickedProfile` applies a region picked in the view.
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
    return { document: replacePart(before, part.id, p => pickedProfile(extrudedSketch(before, p, pickAll))), partId: part.id };
  }
  // Extrude always starts a new extrude, of the part's sketch here, as in the reference: it starts with the regions
  // the sketch's extrudes leave, or none, or with them all when asked. An extrude already made is edited from its step.
  const next = newExtrudeOf(before, part, `Part ${before.parts.length + 1}`);
  const all = pickAll && sketchRegions(next.sketch, CAD_CHORD_TOLERANCE).map(region => region.id);
  const made = pickedProfile(all && all.length ? { ...next, regions: all } : next);
  return { document: { ...before, revision: before.revision + 1, parts: [...before.parts, made] }, partId: made.id };
}
