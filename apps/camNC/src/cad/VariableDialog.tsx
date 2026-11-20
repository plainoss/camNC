import {
  cadFieldVariableExpression,
  cadVariableScope,
  cadVariableValues,
  designSteps,
  newCadId,
  setCadVariable,
  type CadDocument,
} from '@wbcnc/cad';
import { useId, useMemo, useState } from 'react';
import { CadValueInput } from './CadValueInput';
import { useDesignUnits } from './designUnits';
import { FeatureDialog } from './FeatureDialog';
import { formatCadValue } from './valueExpressions';
import { useDialogPreview } from './useDialogPreview';

type VariableType = 'length' | 'angle' | 'number' | 'any';
const kTypes: { id: VariableType; label: string }[] = [
  { id: 'length', label: 'Length' },
  { id: 'angle', label: 'Angle' },
  { id: 'number', label: 'Number' },
  { id: 'any', label: 'Any' },
];
const kUnsupported = 'Not available yet';
const isBare = (text: string) => /^[-+]?(\d+\.?\d*|\.\d+)$/.test(text.trim());

/**
 * A design variable as a step of its own: its name, its type and its value, which can be a length, an angle, a number
 * or, for Any, an expression of other variables. Every value typed elsewhere can then name it. The title reads as its
 * row will, `#name = value`.
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
  const { lengthUnit, formatLength } = useDesignUnits();
  const variable = document.variables?.find(candidate => candidate.id === variableId);
  const known = variable && cadVariableScope(document)[variable.name]?.kind;
  const [type, setType] = useState<VariableType>(known ?? 'length');
  const [name, setName] = useState(variable?.name ?? '');
  const [expression, setExpression] = useState(variable?.expression ?? '0');
  const [description, setDescription] = useState(variable?.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [featureId] = useState(() => variable?.id ?? newCadId());
  // A new variable is listed after the design's last step, as it's made there.
  const [after] = useState(() => (variable ? undefined : designSteps(document).at(-1)?.id));
  const typed = useMemo(() => {
    const text = expression.trim();
    // A bare number is a value of the chosen type: in the design's unit for a length, in degrees for an angle.
    if (type === 'angle' && isBare(text)) return `${text} deg`;
    if (type === 'length' && isBare(text))
      return cadFieldVariableExpression(text, 'scalar', cadVariableScope(document), document.lengthUnit, 'length');
    return text;
  }, [document, expression, type]);
  const result = useMemo(
    () =>
      name.trim()
        ? setCadVariable(document, { id: featureId, name: name.trim(), expression: typed, description, ...(after && { after }) })
        : ({ error: 'Name the variable.' } as const),
    [document, featureId, name, typed, description, after]
  );
  useDialogPreview('error' in result ? null : result.document, onPreview);
  const value = 'error' in result ? undefined : cadVariableValues(result.document).scope[name.trim()];
  const unit = type === 'length' ? ` ${lengthUnit}` : type === 'angle' ? ' deg' : '';
  const shown = value
    ? `${value.kind === 'length' ? formatLength(value.value) : formatCadValue(value.value)}${value.kind === 'length' ? ` ${lengthUnit}` : value.kind === 'angle' ? ' deg' : ''}`
    : `${expression.trim() || '0'}${unit}`;
  const save = () => {
    if ('error' in result) return setError(result.error);
    onSave(result.document);
  };
  return (
    <FeatureDialog title={`#${name.trim() || '?'} = ${shown}`} okDisabled={!name.trim()} onOk={save} onCancel={onCancel}>
      <div className="cad-feature-tabs" role="tablist" aria-label="Variable source">
        {['Assigned', 'Measured', 'From import'].map(choice => (
          <button
            key={choice}
            type="button"
            role="tab"
            aria-selected={choice === 'Assigned'}
            disabled={choice !== 'Assigned'}
            title={choice === 'Assigned' ? undefined : kUnsupported}>
            {choice}
          </button>
        ))}
      </div>
      <div className="cad-feature-tabs" role="tablist" aria-label="Variable type">
        {kTypes.map(choice => (
          <button key={choice.id} type="button" role="tab" aria-selected={type === choice.id} onClick={() => setType(choice.id)}>
            {choice.label}
          </button>
        ))}
      </div>
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
        {isBare(expression) && unit.trim()}
      </label>
      <label className="cad-number-field" htmlFor={`${id}-description`}>
        Description
        <span>
          <input id={`${id}-description`} value={description} onChange={event => setDescription(event.target.value)} />
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
