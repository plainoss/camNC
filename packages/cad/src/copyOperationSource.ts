import type { CadDocument } from './types';

/** Structural checks precede history formatting or geometry. References may be absent; their source IDs stay editable. */
export function copyOperationSourceIssue(document: CadDocument): string | null {
  const present = document.operationOrder !== undefined || document.copyTransforms !== undefined || document.legacyPartCutIds !== undefined;
  if (!present) return document.version === 4 ? 'Reader version 4 requires an explicit operation order.' : null;
  // Later readers (5 adds Cut parts corner relief) keep ordered operations, so 4 is a floor, not an exact match.
  if (document.version < 4) return 'Physical-copy operations require reader version 4.';
  const ids = new Set<string>();
  const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
  const vector = (value: unknown, length: number) =>
    Array.isArray(value) &&
    value.length === length &&
    [...value].every(component => typeof component === 'number' && Number.isFinite(component));
  if (document.copyTransforms !== undefined && !Array.isArray(document.copyTransforms)) return 'Invalid physical-copy transforms.';
  for (const move of document.copyTransforms ?? []) {
    if (
      !move ||
      typeof move !== 'object' ||
      !text(move.id) ||
      ids.has(move.id) ||
      !text(move.partId) ||
      !(move.seed === true ? move.copyId === undefined : move.seed === undefined && text(move.copyId)) ||
      !vector(move.by, 3) ||
      (move.suppressed !== undefined && move.suppressed !== true)
    )
      return 'Invalid physical-copy transform.';
    ids.add(move.id);
    if (
      move.byExpressions !== undefined &&
      (!Array.isArray(move.byExpressions) ||
        move.byExpressions.length !== 3 ||
        [...move.byExpressions].some(value => value !== null && typeof value !== 'string'))
    )
      return 'Invalid copy translation expressions.';
    if (
      move.turn &&
      (!vector(move.turn.about, 3) ||
        !vector(move.turn.axis, 3) ||
        Math.hypot(...move.turn.axis) === 0 ||
        !Number.isFinite(Math.hypot(...move.turn.axis)) ||
        !Number.isFinite(move.turn.degrees) ||
        (move.turn.degreesExpression !== undefined && typeof move.turn.degreesExpression !== 'string'))
    )
      return 'Invalid copy rotation.';
    if (move.turn !== undefined && (!move.turn || typeof move.turn !== 'object')) return 'Invalid copy rotation.';
  }
  for (const cut of document.partCuts ?? []) {
    if (ids.has(cut.id)) return 'Spatial operation IDs must be unique.';
    ids.add(cut.id);
  }
  const order = document.operationOrder;
  if (
    !Array.isArray(order) ||
    order.length !== ids.size ||
    [...order].some(id => !text(id) || !ids.has(id)) ||
    new Set(order).size !== order.length
  )
    return 'The operation order must name each spatial operation exactly once.';
  const legacy = document.legacyPartCutIds;
  if (
    legacy !== undefined &&
    (!Array.isArray(legacy) ||
      new Set(legacy).size !== legacy.length ||
      [...legacy].some((id, index) => !text(id) || order[index] !== id || !document.partCuts?.some(cut => cut.id === id)))
  )
    return 'Legacy cuts must be an explicit source-ID prefix of the operation order.';
  return null;
}
