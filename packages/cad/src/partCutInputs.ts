import { cadPartReferenceName, cadPartReferenceOwner } from './partReferences';
import { partCutLabel } from './partCutVariables';
import { activeDesign } from './suppression';
import type { CadDiagnostic, CadDocument } from './types';

/**
 * Why each Cut parts step that's switched on can't use one of its tools or targets: the part or copy is deleted,
 * suppressed (by itself, its pattern, its folder or its plane's folder) or only a sketch, so the built design
 * (`activeDesign`) leaves it out and the step cuts less than it says, or nothing. Said on the step's feature row.
 * `copies: false` leaves out single copies that aren't built while their part is: the cut already warns about those
 * (`applyPartCuts`), and a copy that's gone can come back with its pattern count, so a checked design may keep one.
 */
export function partCutInputErrors(
  document: CadDocument,
  { copies = true }: { copies?: boolean } = {}
): { stepId: string; partIds: string[]; message: string }[] {
  // What's built is what the step is given: the same rules for suppressed parts, copies, patterns and folders.
  const built = activeDesign(document);
  const folderCuts = new Set(document.folders?.filter(folder => folder.suppressed).flatMap(folder => folder.partCutIds ?? []));
  const unbuilt = (reference: string, role: 'tool' | 'target'): string[] => {
    const owner = cadPartReferenceOwner(document, reference);
    if (!owner) return [`a deleted ${role}`];
    const name = cadPartReferenceName(document, reference);
    if (owner.extrude === false) return [`its ${role} ${name ?? owner.name}, which isn’t extruded`];
    if (built.parts.find(part => part.id === owner.id)?.extrude === false)
      return [`its ${role} ${name ?? owner.name}, which is suppressed`];
    if (reference === owner.id || !copies) return [];
    // A copy that's gone, such as one past a pattern's count, can't be named.
    if (!name) return [`its ${role}, a deleted copy of ${owner.name}`];
    if (!cadPartReferenceName(built, reference)) return [`its ${role} ${name}, which is suppressed`];
    return [];
  };
  return (document.partCuts ?? []).flatMap(step => {
    // A step that's switched off cuts nothing anyway, so what it uses doesn't matter until it's back on.
    if (step.suppressed || folderCuts.has(step.id)) return [];
    const label = partCutLabel(document, step);
    const missing = [...step.tools.flatMap(id => unbuilt(id, 'tool')), ...step.targets.flatMap(id => unbuilt(id, 'target'))];
    if (!missing.length) return [];
    const message = `${label} can’t use ${missing.join(', or ')}.`;
    const partIds = [
      ...new Set(
        [...step.tools, ...step.targets].flatMap(reference => {
          const owner = cadPartReferenceOwner(document, reference);
          return owner ? [owner.id] : [];
        })
      ),
    ];
    return [{ stepId: step.id, partIds, message }];
  });
}

/**
 * `partCutInputErrors` for parts that aren't built, as errors on the parts each step joins; a step whose parts are all
 * gone still says so once. A single copy that isn't built stays the cut's warning.
 */
export function partCutInputProblems(document: CadDocument): CadDiagnostic[] {
  return partCutInputErrors(document, { copies: false }).flatMap(({ partIds, message }) =>
    (partIds.length ? partIds : [undefined]).map(
      (partId): CadDiagnostic => ({ code: 'part-cut-input', severity: 'error', ...(partId && { partId }), message })
    )
  );
}
