import type { CadDocument, EvaluatedCadPart } from '@wbcnc/cad';
import { readOutlineNotchNote } from '@wbcnc/cam';

/**
 * The design check's note for a part whose outline has notches the planned bit can't enter, such as the slots of a
 * finger joint with fingers narrower than the bit: CAM cuts straight across them, so the joint can't go together.
 * Names the finger joints the part is in, when it is in any, and the narrowest notch against the bit.
 */
export function narrowFingersWarning(
  document: CadDocument,
  part: EvaluatedCadPart,
  camWarnings: readonly string[],
  nameOf: (partId: string) => string | undefined
): string | undefined {
  const note = camWarnings.map(readOutlineNotchNote).find(found => found !== undefined);
  if (!note) return undefined;
  const fingerSteps = new Set((document.partCuts ?? []).filter(step => typeof step.split === 'object').map(step => step.id));
  // Each finger joint cuts `cut-parts:<step>:<other part>…` into both of its parts.
  const partners = [
    ...new Set(
      (part.cuts ?? []).flatMap(cut => {
        const [, step, other] = /^cut-parts:([^:]+):([^:#]+)/.exec(cut.id) ?? [];
        const name = step && fingerSteps.has(step) ? nameOf(other!) : undefined;
        return name ? [name] : [];
      })
    ),
  ];
  const bit = `narrower than the ⌀${note.diameter} mm bit`;
  if (!partners.length)
    return `The outline has ${note.notches === 1 ? 'a notch' : `${note.notches} notches`} about ${note.width} mm wide, ${bit}: CAM runs the outline straight across, so ${note.notches === 1 ? "it isn't" : "they aren't"} cut. Use a smaller bit or widen ${note.notches === 1 ? 'it' : 'them'}.`;
  const slots = note.notches === 1 ? 'its slot' : `its ${note.notches} slots`;
  return `The fingers of the finger joint with ${partners.join(', ')} are about ${note.width} mm wide, ${bit}: CAM runs the outline straight across ${slots}, so the joint isn't cut. Use fewer fingers or a smaller bit.`;
}
