import { cadPartReferenceName, cadPartReferenceOwner } from './partReferences';
import { partCutLabel } from './partCutVariables';
import type { CadDiagnostic, CadDocument } from './types';

/**
 * Why each Cut parts step that's switched on can't use one of its tools or targets: the part is deleted, suppressed
 * (by itself or its folder) or only a sketch, so the built design leaves it out of the step (`activeDesign`) and the
 * step cuts less than it says, or nothing. Said on the step's feature row and on each part the step still joins.
 */
export function partCutInputErrors(document: CadDocument): { stepId: string; partIds: string[]; message: string }[] {
  const masked = document.folders?.filter(folder => folder.suppressed) ?? [];
  const folderParts = new Set(masked.flatMap(folder => folder.partIds));
  const folderCuts = new Set(masked.flatMap(folder => folder.partCutIds ?? []));
  const unbuilt = (reference: string, role: 'tool' | 'target'): string[] => {
    const owner = cadPartReferenceOwner(document, reference);
    const name = cadPartReferenceName(document, reference) ?? owner?.name;
    if (!owner || !name) return [`a deleted ${role}`];
    if (owner.suppressed || folderParts.has(owner.id)) return [`its ${role} ${name}, which is suppressed`];
    if (owner.extrude === false) return [`its ${role} ${name}, which isn’t extruded`];
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

/** `partCutInputErrors` as errors on the parts each step joins; a step whose parts are all gone still says so once. */
export function partCutInputProblems(document: CadDocument): CadDiagnostic[] {
  return partCutInputErrors(document).flatMap(({ partIds, message }) =>
    (partIds.length ? partIds : [undefined]).map(
      (partId): CadDiagnostic => ({ code: 'part-cut-input', severity: 'error', ...(partId && { partId }), message })
    )
  );
}
