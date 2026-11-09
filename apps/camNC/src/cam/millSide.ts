import { mirrorEvaluatedPart, type EvaluatedCadPart } from '@wbcnc/cad';

/**
 * Whether the part is milled with its underside up: everything it needs from one face is on the underside, so turning
 * it over saves a second setup. A through cut goes through from either face.
 */
export function millsUndersideUp(part: Pick<EvaluatedCadPart, 'cuts'>): boolean {
  const cuts = part.cuts ?? [];
  return (
    cuts.some(cut => cut.side === 'underside' && !cut.through) &&
    !cuts.some(cut => cut.side !== 'underside' && (!cut.through || cut.from > 0))
  );
}

/**
 * The part as it lies on the board: turned over about its sketch's Y axis when it {@link millsUndersideUp}, so its
 * underside cuts are cut from the top. Its ID and hole loops stay the same.
 */
export function asMilled(part: EvaluatedCadPart): EvaluatedCadPart {
  if (!millsUndersideUp(part)) return part;
  const mirrored = mirrorEvaluatedPart(part);
  const turned: EvaluatedCadPart = {
    ...mirrored,
    partId: part.partId,
    cuts: mirrored.cuts!.map(cut => ({ ...cut, side: cut.side === 'underside' ? 'top' : 'underside' })),
  };
  // Copies that differ are separate parts by now, in the sketch's own frame.
  delete turned.copyCuts;
  return turned;
}
