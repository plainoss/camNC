import type { CadDocument, CadPoint, EvaluatedCadPart } from '@wbcnc/cad';
import { describeOutlineNotches, type OutlineNotches } from '@wbcnc/cam';

/** How far from a joint's slot a notch's middle may lie and still be that slot, mm. */
const kNear = 0.5;

/**
 * The design check's notes for a part whose outline or holes keep material the planned bit can't reach. Notches that
 * lie in the slots of a finger joint, narrower than the bit, name that joint by the other part: CAM cuts straight
 * across them, so the joint can't go together. `offset`: where the planner's part coordinates start in the part's.
 */
export function narrowFingersWarnings(
  document: CadDocument,
  part: EvaluatedCadPart,
  notches: readonly OutlineNotches[],
  offset: CadPoint,
  nameOf: (partId: string) => string | undefined
): string[] {
  const fingerSteps = new Set((document.partCuts ?? []).filter(step => typeof step.split === 'object').map(step => step.id));
  // Each finger joint cuts `cut-parts:<step>:<other part>…` into both of its parts.
  const slots = (part.cuts ?? []).flatMap(cut => {
    const [, step, other] = /^cut-parts:([^:]+):([^:#]+)/.exec(cut.id) ?? [];
    if (!step || !fingerSteps.has(step)) return [];
    const xs = cut.outline.map(p => p.x),
      ys = cut.outline.map(p => p.y);
    return [{ other: other!, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }];
  });
  return notches.map(n => {
    // Only a joint whose slots hold the notches is to blame.
    const partners = n.spans
      ? [
          ...new Set(
            n.at.flatMap(at => {
              const [x, y] = [at.x + offset.x, at.y + offset.y];
              return slots
                .filter(s => x >= s.x0 - kNear && x <= s.x1 + kNear && y >= s.y0 - kNear && y <= s.y1 + kNear)
                .flatMap(s => nameOf(s.other) ?? []);
            })
          ),
        ]
      : [];
    if (!partners.length || n.inside) return `CAM can't cut all of it. ${describeOutlineNotches(n)}`;
    const wide = n.width >= n.diameter - 0.05 ? 'no wider than' : 'narrower than';
    const across = n.count === 1 ? 'its slot' : `its ${n.count} slots`;
    return `The fingers of the finger joint with ${partners.join(', ')} are about ${+n.width.toFixed(1)} mm wide, ${wide} the ⌀${n.diameter} mm bit: CAM runs the outline straight across ${across}, so the joint isn't cut. Use fewer fingers or a smaller bit.`;
  });
}

/** Every loop of a part, cuts and their islands included. */
const partLoops = (part: EvaluatedCadPart) => [
  part.outline,
  ...part.holes,
  ...(part.cuts ?? []).flatMap(cut => [cut.outline, ...cut.islands]),
];

/**
 * The notches left once those in a corner relieved for a smaller bit are taken out: the relief note names them. A
 * bone's points are the part's points that the part as drawn (`asDrawn`, without bones) doesn't have; a notch whose
 * middle is within the bit's radius of one is in that corner. An entry keeps its other notches, its area shared out
 * evenly among them.
 */
export function notchesBesideBones(
  notches: readonly OutlineNotches[],
  part: EvaluatedCadPart,
  asDrawn: EvaluatedCadPart,
  offset: CadPoint
): OutlineNotches[] {
  const key = (p: CadPoint) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
  const drawn = new Set(partLoops(asDrawn).flatMap(loop => loop.map(key)));
  const bones = partLoops(part)
    .flat()
    .filter(p => !drawn.has(key(p)));
  if (!bones.length) return [...notches];
  return notches.flatMap(n => {
    const near = (at: { x: number; y: number }) =>
      bones.some(p => Math.hypot(p.x - (at.x + offset.x), p.y - (at.y + offset.y)) <= n.diameter / 2);
    const at = n.at.filter(spot => !near(spot));
    if (at.length === n.at.length) return [n];
    return at.length ? [{ ...n, count: at.length, at, area: (n.area * at.length) / n.at.length }] : [];
  });
}
