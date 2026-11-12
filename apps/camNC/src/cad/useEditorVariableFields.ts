import { useMemo, type RefObject } from 'react';
import { cadFieldVariableExpression, cadVariableScope, formatCadValue, setCadVariable, type CadDocument } from '@wbcnc/cad';
import { useDesignUnits } from './designUnits';
import { useProvideCadVariableFields, type CadVariableFields } from './variableFields';

export function useEditorVariableFields(document: CadDocument, current: RefObject<CadDocument>, commit: (document: CadDocument) => void) {
  const scope = useMemo(() => cadVariableScope(document), [document]);
  const { lengthUnit, formatLength } = useDesignUnits(document.lengthUnit ?? 'mm');
  const fields = useMemo<CadVariableFields>(
    () => ({
      variables: (document.variables ?? []).map(variable => {
        const result = scope[variable.name];
        const unit = result?.kind === 'length' ? ` ${lengthUnit}` : result?.kind === 'angle' ? '°' : '';
        const value = result && (result.kind === 'length' ? formatLength(result.value) : formatCadValue(result.value));
        return { name: variable.name, shown: result ? `${value}${unit}` : variable.expression };
      }),
      define: (name, expression, unit = 'mm') => {
        const source = current.current;
        const existing = source.variables?.find(variable => variable.name === name);
        // A plain number takes the field's unit, so the variable keeps its size when the design's unit changes.
        const typed = cadFieldVariableExpression(expression, unit, cadVariableScope(source), source.lengthUnit);
        const result = setCadVariable(source, { ...(existing && { id: existing.id }), name, expression: typed });
        if ('error' in result) return result.error;
        commit(result.document);
        return null;
      },
    }),
    // The ref and commit target the same editor session throughout its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [document.variables, scope, lengthUnit, formatLength]
  );
  useProvideCadVariableFields(fields);
  return scope;
}
