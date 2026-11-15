import { designSteps, type CadDocument } from '@wbcnc/cad';

/**
 * A change that takes steps out of the design leaves the rest named as they were, as Extrude 2 stays Extrude 2 when
 * Extrude 1 is deleted: a numbered name that would change is kept as the step's own name.
 */
export function keepStepNames(before: CadDocument, after: CadDocument): CadDocument {
  const was = new Map(designSteps(before).map(step => [step.id, step.label]));
  let parts = after.parts;
  for (const step of designSteps(after)) {
    const name = was.get(step.id);
    if ((step.kind !== 'sketch' && step.kind !== 'extrude') || !name || name === step.label) continue;
    parts = parts.map(part =>
      part.id !== step.partId ? part : step.kind === 'sketch' ? { ...part, sketchName: name } : { ...part, extrudeName: name }
    );
  }
  return parts === after.parts ? after : { ...after, parts };
}
