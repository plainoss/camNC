import { cadVariableScope } from './variables';
import { parseCadValue } from './valueExpressions';
import type { CadDocument, CadLengthUnit } from './types';

/** Changing display units preserves the mm meaning of previously authored bare length expressions. */
export function withCadLengthUnit(document: CadDocument, lengthUnit: CadLengthUnit): CadDocument {
  if ((document.lengthUnit ?? 'mm') === lengthUnit) return document;
  const variables = cadVariableScope(document);
  const explicit = (expression: unknown) => {
    if (typeof expression !== 'string') return expression;
    const text = `(${expression.replace(/^=/, '')}) mm`;
    // Named lengths and explicit units are already dimensional: adding another unit would be invalid.
    return 'value' in parseCadValue(text, { variables }) ? text : expression;
  };
  const next = structuredClone(document);
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const object = value as Record<string, unknown>;
    for (const key of ['thickness', 'offset', 'radius', 'diameter', 'depth', 'clearance', 'distance', 'spacing']) {
      if (typeof object[key] === 'number' && typeof object[`${key}Expression`] === 'string')
        object[`${key}Expression`] = explicit(object[`${key}Expression`]);
    }
    if (typeof object.value === 'number' && object.type !== 'angle' && typeof object.expression === 'string')
      object.expression = explicit(object.expression);
    for (const key of ['positionExpressions', 'byExpressions']) if (Array.isArray(object[key])) object[key] = object[key].map(explicit);
    if (object.type === 'linearPattern' && object.expressions) {
      const expressions = object.expressions as Record<string, unknown>;
      for (const key of ['spacingX', 'spacingY']) if (typeof expressions[key] === 'string') expressions[key] = explicit(expressions[key]);
    }
    Object.values(object).forEach(visit);
  };
  visit(next);
  return { ...next, lengthUnit };
}
