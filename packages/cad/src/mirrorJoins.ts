import { CAD_IDENTITY_PLACEMENT } from './placement';
import type { CadDiagnostic, CadMirrorJoin, CadPart, CadPoint, EvaluatedCadPart } from './types';
import { unitedPart } from './unionParts';

/** A point reflected across a Mirror › Add's line. */
const reflect = (line: NonNullable<CadMirrorJoin['line']>, p: CadPoint): CadPoint => {
  const along = 2 * ((p.x - line.x) * line.nx + (p.y - line.y) * line.ny);
  return { x: p.x - along * line.nx, y: p.y - along * line.ny };
};
/** Reflected and walked the other way round, so an outline keeps its winding. */
const reflectLoop = (line: NonNullable<CadMirrorJoin['line']>, points: CadPoint[]) => points.map(p => reflect(line, p)).reverse();

/** The part's mirror image across a Mirror › Add's line, in its own sketch coordinates. */
function mirrorImage(shape: EvaluatedCadPart, join: CadMirrorJoin & { line: NonNullable<CadMirrorJoin['line']> }): EvaluatedCadPart {
  const { line } = join;
  return {
    ...shape,
    outline: reflectLoop(line, shape.outline),
    holes: shape.holes.map(hole => reflectLoop(line, hole)),
    loops: shape.loops.map(loop => ({ ...loop, id: `${loop.id}:mirror:${join.id}`, points: reflectLoop(line, loop.points) })),
  };
}

/** Why a Mirror › Add can't join the part with its mirror image, or null when it can. */
export function mirrorJoinProblem(part: CadPart, shape: EvaluatedCadPart, join: CadMirrorJoin): string | null {
  const joined = joinedWith(part, shape, join);
  return 'refused' in joined ? joined.refused : null;
}

function joinedWith(part: CadPart, shape: EvaluatedCadPart, join: CadMirrorJoin): { part: EvaluatedCadPart } | { refused: string } {
  if (!join.line) return { refused: 'Select a mirror plane that stands across the part. 1 missing selection' };
  // Its pockets and cuts are made after the join, on one half only, so a part with them isn't mirrored yet.
  if (part.features?.length) return { refused: 'Failed to mirror selections.' };
  const at = CAD_IDENTITY_PLACEMENT;
  const made = unitedPart({ shape, source: part, at }, [{ shape: mirrorImage(shape, { ...join, line: join.line }), source: part, at }]);
  return 'refused' in made ? { refused: 'Failed to mirror selections.' } : made;
}

/**
 * The part as its Mirror › Add steps make it: joined with its mirror image across each plane in turn. One that can't be
 * made leaves the part as it was, and says so on its row.
 */
export function withMirrorJoins(
  part: CadPart,
  made: { part?: EvaluatedCadPart; diagnostics: CadDiagnostic[] }
): { part?: EvaluatedCadPart; diagnostics: CadDiagnostic[] } {
  let shape = made.part;
  const diagnostics = [...made.diagnostics];
  for (const join of part.mirrorJoins ?? []) {
    if (join.suppressed || !shape) continue;
    const joined = joinedWith(part, shape, join);
    if ('part' in joined) shape = joined.part;
    else
      diagnostics.push({ code: 'mirror-unresolved', severity: 'warning', partId: part.id, entityIds: [join.id], message: joined.refused });
  }
  return { part: shape, diagnostics };
}
