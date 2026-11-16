import { useMemo, useRef, type RefObject } from 'react';
import { cadFieldVariableExpression, cadVariableScope, formatCadValue, setCadVariable, type CadDocument } from '@wbcnc/cad';
import { useDesignUnits } from './designUnits';
import { useProvideCadVariableFields, type CadVariableFields } from './variableFields';

/** The step a dialog or an open sketch edits, as the feature list names it: an Extrude's, or the sketch's. */
export function editedStep(dialog: { kind: string; partId?: string } | null, sketching?: string | false): string | null {
  if (dialog?.kind === 'extrude' && dialog.partId) return `${dialog.partId}:extrude`;
  return sketching ? `${sketching}:sketch` : null;
}

export function useEditorVariableFields(
  document: CadDocument,
  current: RefObject<CadDocument>,
  commit: (document: CadDocument) => void,
  /** The step being edited: a variable made in one of its fields is listed before it. */
  editingStep: string | null = null
) {
  const editing = useRef<string | null>(null);
  editing.current = editingStep;
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
        // A plain number takes the field's unit, so the variable keeps its size when the design's unit changes. One
        // that's there keeps its kind.
        const variables = cadVariableScope(source);
        const typed = cadFieldVariableExpression(expression, unit, variables, source.lengthUnit, existing && variables[name]?.kind);
        const result = setCadVariable(source, { ...(existing && { id: existing.id }), name, expression: typed });
        if ('error' in result) return result.error;
        const before = !existing && editing.current;
        commit(
          before
            ? { ...result.document, variables: result.document.variables?.map(v => (v.name === name ? { ...v, before } : v)) }
            : result.document
        );
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
