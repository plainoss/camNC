import { mapTypedExpressions } from './typedValues';
import type { CadDocument, CadLengthUnit } from './types';
import { parseCadValue, type CadValueScope, type CadValueUnit } from './valueExpressions';
import { cadVariableExpression, cadVariableScope } from './variables';

/**
 * How a saved expression reads in any design unit. Saved expressions are worked out in mm, so a plain number read as a
 * length is in mm: `t + 0.125` adds 0.125 mm. This writes that unit out (`t + 0.125 mm`, `(2 * 60) mm`), so the text
 * means the same once it's read, or edited, in another unit. Named lengths, explicit units and unitless values stay as
 * they are.
 */
function portableExpression(expression: string, unit: CadValueUnit, variables: CadValueScope): string {
  const parsed = parseCadValue(expression, { unit, variables, spellOutLengths: true });
  if ('error' in parsed) return expression;
  const spelled = parsed.expression ?? expression;
  if (unit !== 'mm') return spelled;
  const text = `(${spelled.replace(/^=/, '')}) mm`;
  // Named lengths and explicit units are already dimensional: adding another unit would be invalid.
  return 'value' in parseCadValue(text, { variables }) ? text : spelled;
}

/** Every saved expression written to read the same in any design unit, as `portableExpression` says. */
export function withPortableLengths(document: CadDocument): CadDocument {
  const variables = cadVariableScope(document);
  const next = mapTypedExpressions(document, (expression, unit) => portableExpression(expression, unit, variables));
  const named = document.variables?.map(variable => ({
    ...variable,
    expression: cadVariableExpression(variable.expression, variables, 'mm', true),
  }));
  return named && named.some((variable, index) => variable.expression !== document.variables![index]!.expression)
    ? { ...next, variables: named }
    : next;
}

/**
 * Designs saved in inches, cm, m or ft before a plain number next to a variable was read in the design's unit have
 * expressions like `t + 0.125` that mean mm. Loading writes that mm out, so they keep their size and say what they are.
 */
export const migrateDesignUnitNumbers = (document: CadDocument): CadDocument =>
  (document.lengthUnit ?? 'mm') === 'mm' ? document : withPortableLengths(document);

/** Changing display units preserves the mm meaning of previously authored bare length expressions. */
export function withCadLengthUnit(document: CadDocument, lengthUnit: CadLengthUnit): CadDocument {
  if ((document.lengthUnit ?? 'mm') === lengthUnit) return document;
  return { ...withPortableLengths(document), lengthUnit };
}
