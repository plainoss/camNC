import { cadPartReferenceName, cadPartReferenceOwner } from './partReferences';
import { partCutReliefOutcome } from './partCutRelief';
import type { CadDocument, CadPartCut } from './types';
import { cadExpressionNames, parseCadValue, type CadValueScope } from './valueExpressions';

/** A typed value worked out, or why it can't be; `got` is a value that was worked out but isn't allowed. */
type Outcome = { value: number } | { error: string; got?: number };

const usesVariables = (expression: string | undefined): expression is string => !!expression && cadExpressionNames(expression).length > 0;

const names = (document: CadDocument, ids: string[]) => ids.map(id => cadPartReferenceName(document, id) ?? 'a removed part').join(', ');

/** The feature list's name for a Cut parts step. */
export const partCutLabel = (document: CadDocument, step: CadPartCut) =>
  `Cut ${names(document, step.targets)} with ${names(document, step.tools)}`;

/** The step's clearance as its variables say, or why it can't be; null when it doesn't use any. */
export function partCutClearanceOutcome(step: CadPartCut, scope: CadValueScope): Outcome | null {
  if (!usesVariables(step.clearanceExpression)) return null;
  const parsed = parseCadValue(step.clearanceExpression, { unit: 'mm', variables: scope });
  if ('error' in parsed) return parsed;
  return parsed.value >= 0 ? parsed : { error: 'a clearance can’t be less than nothing.', got: parsed.value };
}

/** The step's finger count as its variables say, or why it can't be; null when it doesn't use any. */
export function partCutFingersOutcome(step: CadPartCut, scope: CadValueScope): Outcome | null {
  if (typeof step.split !== 'object' || !usesVariables(step.split.fingersExpression)) return null;
  const parsed = parseCadValue(step.split.fingersExpression, { unit: 'scalar', variables: scope });
  if ('error' in parsed) return parsed;
  return Number.isInteger(parsed.value) && parsed.value >= 2
    ? parsed
    : { error: 'a finger joint needs a whole number of fingers, at least 2.', got: parsed.value };
}

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
    const typed = (what: string, expression: string, outcome: Outcome | null, unit = '') =>
      outcome && 'error' in outcome && !covered(expression)
        ? [`${what} ${expression}${outcome.got === undefined ? '' : ` = ${+outcome.got.toFixed(3)}${unit}`} in ${label}: ${outcome.error}`]
        : [];
    const messages = [
      ...typed('Clearance', step.clearanceExpression ?? '', partCutClearanceOutcome(step, scope), ' mm'),
      ...(typeof step.split === 'object'
        ? typed('Finger count', step.split.fingersExpression ?? '', partCutFingersOutcome(step, scope))
        : []),
      ...(step.cornerRelief?.diameterExpression
        ? typed('Cutter diameter', step.cornerRelief.diameterExpression, partCutReliefOutcome(step, scope), ' mm')
        : []),
    ];
    // Said on each part the step joins, tools first; copy IDs can hold colons, so each reference is matched to its part.
    const partIds = [
      ...new Set([...step.tools, ...step.targets].flatMap(reference => cadPartReferenceOwner(document, reference)?.id ?? [])),
    ];
    return messages.map(message => ({ stepId: step.id, partIds, message }));
  });
}
