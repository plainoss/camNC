import { onLoop, relieveLoopCorners } from './cornerRelief';
import { pointInPolygon } from './geometry';
import type { CadPoint, EvaluatedCadCut, EvaluatedCadPart } from './types';

const kSquare = 1e-6;

type Opening = NonNullable<EvaluatedCadCut['opening']>;
const squareOf = ({ x0, y0, x1, y1 }: Opening): CadPoint[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
/** mm up from the part's underside that a cut spans. */
const depthOf = (cut: EvaluatedCadCut, t: number): [number, number] =>
  cut.through ? [0, t] : cut.side === 'top' ? [t - cut.to, t - cut.from] : [cut.from, cut.to];
const overlaps = (a: [number, number], b: [number, number]) => a[0] < b[1] - kSquare && a[1] > b[0] + kSquare;
/** The pieces `#n` of one tool's opening join each other, so their bones may meet. */
const pieceOf = (id: string) => id.replace(/#\d+$/, '');

/**
 * Relieves the corners of every Cut parts opening in `part` again from its square `opening`, for its `relief` diameter,
 * so the result doesn't depend on which step came first. A bone isn't cut, and its corner stays square, where it would
 * break out of the part's outline or into a hole or another opening at an overlapping depth with a wall between them. A
 * corner already inside or on another opening has no wall there to keep. Bones are checked against the other openings'
 * squares and then against their bones, so two facing bones both stay out. `skipped`: each opening's square corners.
 */
export function relieveStepOpenings(part: EvaluatedCadPart): { part: EvaluatedCadPart; skipped: Map<string, CadPoint[]> } {
  const cuts = part.cuts ?? [];
  const t = part.thickness;
  const relieved = cuts.filter(cut => cut.opening && cut.relief);
  if (!relieved.length) return { part, skipped: new Map() };
  const relieve = (cut: EvaluatedCadCut, shapeOf: (other: EvaluatedCadCut) => CadPoint[]) => {
    const z = depthOf(cut, t);
    const walls = [
      ...part.holes,
      ...cuts.filter(other => pieceOf(other.id) !== pieceOf(cut.id) && overlaps(depthOf(other, t), z)).map(shapeOf),
    ];
    const fits = (bone: CadPoint[], corner: CadPoint) =>
      (!pointInPolygon(corner, part.outline) || bone.every(p => pointInPolygon(p, part.outline))) &&
      walls.every(wall => pointInPolygon(corner, wall) || onLoop(corner, wall) || !bone.some(p => pointInPolygon(p, wall)));
    return relieveLoopCorners(squareOf(cut.opening!), true, cut.relief!, part.outline, fits);
  };
  const square = (cut: EvaluatedCadCut) => (cut.opening && cut.relief ? squareOf(cut.opening) : cut.outline);
  const first = new Map(relieved.map(cut => [cut, relieve(cut, square).points]));
  const skipped = new Map<string, CadPoint[]>();
  const next = cuts.map(cut => {
    if (!first.has(cut)) return cut;
    const result = relieve(cut, other => first.get(other) ?? other.outline);
    if (result.skipped.length) skipped.set(cut.id, result.skipped);
    return { ...cut, outline: result.points };
  });
  return { part: { ...part, cuts: next }, skipped };
}
