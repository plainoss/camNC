import { parseCadValue, type CadValueScope } from './valueExpressions';
import type { CadPhysicalTransform } from './types';

/** Resolve typed values without changing operation identities or source creation placements. */
export function copyTransformValue<T extends CadPhysicalTransform>(move: T, scope: CadValueScope): { move: T } | { error: string } {
  const by = [...move.by] as T['by'];
  for (let axis = 0; axis < 3; axis++) {
    const expression = move.byExpressions?.[axis];
    if (!expression) continue;
    const parsed = parseCadValue(expression, { unit: 'mm', variables: scope });
    if ('error' in parsed) return { error: `Translation ${expression}: ${parsed.error}` };
    by[axis] = parsed.value;
  }
  let turn = move.turn;
  if (turn?.degreesExpression) {
    const parsed = parseCadValue(turn.degreesExpression, { unit: 'deg', variables: scope });
    if ('error' in parsed) return { error: `Rotation ${turn.degreesExpression}: ${parsed.error}` };
    if (parsed.value !== turn.degrees) turn = { ...turn, degrees: parsed.value };
  }
  return { move: turn === move.turn && by.every((value, axis) => value === move.by[axis]) ? move : { ...move, by, ...(turn && { turn }) } };
}

export function editCopyTransformExpressions<T extends CadPhysicalTransform>(move: T, edit: (expression: string) => string): T {
  return {
    ...move,
    ...(move.byExpressions && {
      byExpressions: move.byExpressions.map(expression => (expression === null ? null : edit(expression))) as T['byExpressions'],
    }),
    ...(move.turn?.degreesExpression && { turn: { ...move.turn, degreesExpression: edit(move.turn.degreesExpression) } }),
  };
}
