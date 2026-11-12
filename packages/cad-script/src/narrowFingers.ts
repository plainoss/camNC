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
