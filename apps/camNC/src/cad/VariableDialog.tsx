import { cadFieldVariableExpression, cadVariableScope, newCadId, setCadVariable, type CadDocument } from '@wbcnc/cad';
import { useId, useMemo, useState } from 'react';
import { CadValueInput } from './CadValueInput';
import { FeatureDialog } from './FeatureDialog';
import { useDialogPreview } from './useDialogPreview';

/**
 * A design variable as a step of its own: its name and its value, which can be a length, a number or an expression of
 * other variables. Every value typed elsewhere can then name it.
 */
export function VariableDialog({
  document,
  variableId,
  onSave,
  onPreview,
  onCancel,
}: {
  document: CadDocument;
  /** The variable being changed, or none for a new one. */
  variableId?: string;
  onSave: (document: CadDocument) => void;
  onPreview?: (document: CadDocument | null) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const variable = document.variables?.find(candidate => candidate.id === variableId);
  const [name, setName] = useState(variable?.name ?? '');
  const [expression, setExpression] = useState(variable?.expression ?? '');
  const [error, setError] = useState<string | null>(null);
  const [featureId] = useState(() => variable?.id ?? newCadId());
  const result = useMemo(() => {
    // A length or an angle typed as a bare number stays one, in the design's unit, as its uses expect a length.
    const scope = cadVariableScope(document);
    const kind = variable && scope[variable.name]?.kind;
    const typed =
      kind === 'length' || kind === 'angle'
        ? cadFieldVariableExpression(expression.trim(), 'scalar', scope, document.lengthUnit, kind)
        : expression.trim();
    return setCadVariable(document, { id: featureId, name: name.trim(), expression: typed });
  }, [document, featureId, name, expression, variable]);
  useDialogPreview('error' in result ? null : result.document, onPreview);
  const save = () => {
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
