import { cadPartReferenceName, cadPartReferenceOwner } from './partReferences';
import type { CadDocument, CadPartCut } from './types';
import { kPartCutClearance, kPartCutFingers, usesVariables, workOutTypedValue, type TypedValueKind } from './typedValues';
import type { CadValueScope } from './valueExpressions';

const names = (document: CadDocument, ids: string[]) => ids.map(id => cadPartReferenceName(document, id) ?? 'a removed part').join(', ');

/** The feature list's name for a Cut parts step. */
export const partCutLabel = (document: CadDocument, step: CadPartCut) =>
  `Cut ${names(document, step.targets)} with ${names(document, step.tools)}`;

/**
 * Why each Cut parts step that's switched on can't follow its variables, and the parts it joins that say so. A step
 * keeps its last good values meanwhile. `covered` leaves out an expression whose variable is itself in error.
 */
export function partCutVariableErrors(
  document: CadDocument,
  scope: CadValueScope,
  covered: (expression: string) => boolean = () => false
): { stepId: string; partIds: string[]; message: string }[] {
  // A step that's switched off, by itself or by its folder, cuts nothing, so its values don't matter until it's back on.
  const folderCuts = new Set(document.folders?.filter(folder => folder.suppressed).flatMap(folder => folder.partCutIds ?? []));
  return (document.partCuts ?? []).flatMap(step => {
    if (step.suppressed || folderCuts.has(step.id)) return [];
    const label = partCutLabel(document, step);
    const typed = (expression: string | undefined, kind: TypedValueKind, unit = '') => {
      if (!usesVariables(expression) || covered(expression)) return [];
      const outcome = workOutTypedValue(expression, kind, scope);
      if ('value' in outcome) return [];
      const got = outcome.got === undefined ? '' : ` = ${+outcome.got.toFixed(3)}${unit}`;
      return [`${kind.label} ${expression}${got} in ${label}: ${outcome.error}`];
    };
    const messages = [
      ...typed(step.clearanceExpression, kPartCutClearance, ' mm'),
      ...(typeof step.split === 'object' ? typed(step.split.fingersExpression, kPartCutFingers) : []),
    ];
    // Said on each part the step joins, tools first; copy IDs can hold colons, so each reference is matched to its part.
    const partIds = [
      ...new Set([...step.tools, ...step.targets].flatMap(reference => cadPartReferenceOwner(document, reference)?.id ?? [])),
    ];
    return messages.map(message => ({ stepId: step.id, partIds, message }));
  });
}
