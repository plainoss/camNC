import { kCopyRotation, kCopyTranslation, typedValueProblem, workOutTypedValue } from './typedValues';
import type { CadPhysicalTransform } from './types';
import type { CadValueScope } from './valueExpressions';

/**
 * A move with every typed distance and its turn worked out, or why the first that can't be can't. A move goes as a
 * whole or not at all, so one value that fails leaves the others as they were.
 */
export function copyTransformValue<T extends CadPhysicalTransform>(move: T, scope: CadValueScope): { move: T } | { error: string } {
  const by = [...move.by] as T['by'];
  for (let axis = 0; axis < 3; axis++) {
    const expression = move.byExpressions?.[axis];
    if (!expression) continue;
    const outcome = workOutTypedValue(expression, kCopyTranslation, scope);
    if ('error' in outcome) return { error: typedValueProblem(expression, kCopyTranslation, outcome.error) };
    by[axis] = outcome.value;
  }
  let turn = move.turn;
  if (turn?.degreesExpression) {
    const outcome = workOutTypedValue(turn.degreesExpression, kCopyRotation, scope);
    if ('error' in outcome) return { error: typedValueProblem(turn.degreesExpression, kCopyRotation, outcome.error) };
    if (outcome.value !== turn.degrees) turn = { ...turn, degrees: outcome.value };
  }
  return { move: turn === move.turn && by.every((value, axis) => value === move.by[axis]) ? move : { ...move, by, ...(turn && { turn }) } };
}
