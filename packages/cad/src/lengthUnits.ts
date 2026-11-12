import { mapTypedExpressions } from './typedValues';
import type { CadDocument, CadLengthUnit } from './types';
import { parseCadValue } from './valueExpressions';
import { cadVariableScope } from './variables';

/** Changing display units preserves the mm meaning of previously authored bare length expressions. */
export function withCadLengthUnit(document: CadDocument, lengthUnit: CadLengthUnit): CadDocument {
  if ((document.lengthUnit ?? 'mm') === lengthUnit) return document;
  const variables = cadVariableScope(document);
  const explicit = (expression: string) => {
    const text = `(${expression.replace(/^=/, '')}) mm`;
    // Named lengths and explicit units are already dimensional: adding another unit would be invalid.
    return 'value' in parseCadValue(text, { variables }) ? text : expression;
  };
  return { ...mapTypedExpressions(document, (expression, unit) => (unit === 'mm' ? explicit(expression) : expression)), lengthUnit };
}
