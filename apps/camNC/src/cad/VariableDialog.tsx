import { setCadVariable, type CadDocument } from '@wbcnc/cad';
import { useId, useState } from 'react';
import { CadValueInput } from './CadValueInput';
import { FeatureDialog } from './FeatureDialog';

/**
 * A design variable as a step of its own: its name and its value, which can be a length, a number or an expression of
 * other variables. Every value typed elsewhere can then name it.
 */
export function VariableDialog({
  document,
  variableId,
  onSave,
  onCancel,
}: {
  document: CadDocument;
  /** The variable being changed, or none for a new one. */
  variableId?: string;
  onSave: (document: CadDocument) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const variable = document.variables?.find(candidate => candidate.id === variableId);
  const [name, setName] = useState(variable?.name ?? '');
  const [expression, setExpression] = useState(variable?.expression ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const result = setCadVariable(document, { ...(variable && { id: variable.id }), name: name.trim(), expression: expression.trim() });
    if ('error' in result) return setError(result.error);
    onSave(result.document);
  };
  return (
    <FeatureDialog title={variable ? `#${variable.name}` : 'Variable'} onOk={save} onCancel={onCancel}>
      <label className="cad-number-field" htmlFor={`${id}-name`}>
        Name
        <span>
          <input id={`${id}-name`} value={name} spellCheck={false} onChange={event => setName(event.target.value)} />
        </span>
      </label>
      <label className="cad-number-field" htmlFor={`${id}-value`}>
        Value
        <span>
          <CadValueInput
            bare
            id={`${id}-value`}
            value={expression}
            spellCheck={false}
            placeholder="18 mm"
            aria-invalid={error ? true : undefined}
            onChange={event => setExpression(event.target.value)}
          />
        </span>
      </label>
      {error && (
        <p role="alert" className="cad-thickness-error">
          {error}
        </p>
      )}
    </FeatureDialog>
  );
}
