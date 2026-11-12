import { relieveLoopCorners } from './cornerRelief';
import { pointInPolygon } from './geometry';
import type { CadPoint, EvaluatedCadCut, EvaluatedCadPart } from './types';

const kSquare = 1e-6;

/** What a relieved Cut parts opening was relieved from, so a later opening beside it can take back bones that reach it. */
interface Relieved {
  square: CadPoint[];
  diameter: number;
  z: [number, number];
}
const relievedCuts = new WeakMap<EvaluatedCadCut, Relieved>();

const depthOf = (cut: EvaluatedCadCut, t: number): [number, number] =>
  cut.through ? [0, t] : cut.side === 'top' ? [t - cut.to, t] : [0, cut.to];
const overlaps = (a: [number, number], b: [number, number]) => a[0] < b[1] - kSquare && a[1] > b[0] + kSquare;

/**
 * Relieves one new Cut parts opening in `part`. A bone that would break out of the part's outline, or into a hole or
 * another opening at an overlapping depth, isn't cut and its corner is returned as skipped. Openings cut earlier keep
 * only the bones that stay clear of the new one; `revised` lists those that lost some, with the corners they keep square.
 * `own` says which existing cuts are pieces of the same tool, whose openings join this one.
 */
export function relieveStepOpening(
  part: EvaluatedCadPart,
  square: CadPoint[],
  diameter: number | undefined,
  z: [number, number],
  own: (cut: EvaluatedCadCut) => boolean
) {
  const t = part.thickness;
  const neighbours = (part.cuts ?? []).filter(cut => !own(cut) && overlaps(depthOf(cut, t), z));
  const relief =
    diameter === undefined
      ? { points: square, skipped: [] as CadPoint[] }
      : relieveLoopCorners(square, true, diameter, part.outline, [...part.holes, ...neighbours.map(cut => cut.outline)]);
  const revised: { cut: EvaluatedCadCut; skipped: CadPoint[] }[] = [];
  const cuts = (part.cuts ?? []).map(cut => {
    const earlier = relievedCuts.get(cut);
    if (!earlier || !neighbours.includes(cut) || !cut.outline.some(p => pointInPolygon(p, square))) return cut;
    const others = [
      ...part.holes,
      square,
      ...neighbours.filter(other => other !== cut && overlaps(depthOf(other, t), earlier.z)).map(other => other.outline),
    ];
    const again = relieveLoopCorners(earlier.square, true, earlier.diameter, part.outline, others);
    const next = { ...cut, outline: again.points };
    relievedCuts.set(next, earlier);
    revised.push({ cut: next, skipped: again.skipped });
    return next;
  });
  return {
    ...relief,
    cuts,
    revised,
    /** Records the new cut, so a later opening can revise its bones. */
    remember: (cut: EvaluatedCadCut) => {
      if (diameter !== undefined) relievedCuts.set(cut, { square, diameter, z });
    },
  };
}
