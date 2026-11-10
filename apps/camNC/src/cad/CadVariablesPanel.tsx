import {
  cadExpressionNames,
  cadVariableValues,
  removeCadVariable,
  setCadVariable,
  type CadDocument,
  type CadVariable,
  type CadVariableValue,
} from '@wbcnc/cad';
import { useId, useState, type FocusEvent } from 'react';
import { formatCadValue } from './valueExpressions';
import './cadVariablesPanel.css';

/** Only an expression that names a variable or does arithmetic needs its result shown. */
const worksOut = (expression: string) => cadExpressionNames(expression).length > 0 || /[-+*/()]/.test(expression.replace(/^[+-]/, ''));
const shown = (result: CadVariableValue) =>
  `${formatCadValue(result.value)}${result.kind === 'length' ? ' mm' : result.kind === 'angle' ? '°' : ''}`;

function VariableRow({
  variable,
  result,
  problem,
  onSave,
  onDelete,
  onDone,
}: {
  variable?: CadVariable;
  result?: CadVariableValue;
  problem?: string;
  /** Returns why the change was refused, or null once it's saved. */
  onSave: (name: string, expression: string) => string | null;
  onDelete?: () => string | null;
  onDone: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(variable?.name ?? '');
  const [expression, setExpression] = useState(variable?.expression ?? '');
  const [error, setError] = useState<string | null>(null);
  const reset = () => {
    setName(variable?.name ?? '');
    setExpression(variable?.expression ?? '');
    setError(null);
  };
  const save = () => {
    if (variable && name === variable.name && expression === variable.expression) return true;
    // A new row left empty just goes away.
    if (!variable && !name.trim() && !expression.trim()) {
      onDone();
      return true;
    }
    const refused = onSave(name, expression);
    setError(refused);
    if (!refused && !variable) onDone();
    return !refused;
  };
  const message = error ?? problem;
  return (
    <li
      className="cad-variable"
      onBlur={(event: FocusEvent) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) save();
      }}
      onKeyDown={event => {
        // The sketch's own keys stay out of these fields.
        event.stopPropagation();
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === 'Enter' && save()) {
          event.preventDefault();
          (event.target as HTMLElement).blur();
          onDone();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          reset();
          if (!variable) onDone();
          (event.target as HTMLElement).blur();
        }
      }}>
      <input
        className="cad-variable-name"
        aria-label="Variable name"
        placeholder="name"
        autoFocus={!variable}
        value={name}
        spellCheck={false}
        aria-invalid={message ? true : undefined}
        aria-describedby={message ? `${id}-error` : undefined}
        onChange={event => setName(event.target.value)}
      />
      <span aria-hidden="true">=</span>
      <input
        className="cad-variable-expression"
        aria-label={`Value of ${variable?.name ?? (name || 'the new variable')}`}
        placeholder="600 mm"
        value={expression}
        spellCheck={false}
        aria-invalid={message ? true : undefined}
        aria-describedby={message ? `${id}-error` : undefined}
        onChange={event => setExpression(event.target.value)}
      />
      {variable && onDelete && (
        <button
          type="button"
          className="cad-variable-delete"
          aria-label={`Delete ${variable.name}`}
          title={`Delete ${variable.name}`}
          onClick={() => setError(onDelete())}>
          ×
        </button>
      )}
      {result && !message && worksOut(variable!.expression) && (
        <output className="cad-variable-result" aria-label={`${variable!.name} is`}>
          {shown(result)}
        </output>
      )}
      {message && (
        <p id={`${id}-error`} role="alert" className="cad-variable-error">
          {message}
        </p>
      )}
    </li>
  );
}

/** The design's named values. Type a name into any dimension or thickness to use one; changing it here updates them all. */
export function CadVariablesPanel({
  document,
  onChange,
  folderId,
}: {
  document: CadDocument;
  onChange: (next: CadDocument) => void;
  folderId?: string;
}) {
  const [adding, setAdding] = useState(false);
  const { scope, errors } = cadVariableValues(document);
  const variables = (document.variables ?? []).filter(variable => variable.folderId === folderId);
  const apply = (result: { document: CadDocument } | { error: string }) => {
    if ('error' in result) return result.error;
    onChange(result.document);
    return null;
  };
  return (
    <section className="cad-variables" aria-label="Variables">
      <div className="cad-panel-heading">
        <h2>Variables</h2>
        <button type="button" aria-label="Add variable" onClick={() => setAdding(true)}>
          ＋
        </button>
      </div>
      {!variables.length && !adding && (
        <p className="cad-variables-hint">Name a size, like width or board, and type the name into any dimension.</p>
      )}
      <ul>
        {variables.map(variable => (
          <VariableRow
            key={`${variable.id}:${variable.name}:${variable.expression}`}
            variable={variable}
            result={scope[variable.name]}
            problem={errors[variable.id]}
            onSave={(name, expression) => apply(setCadVariable(document, { id: variable.id, name, expression }))}
            onDelete={() => apply(removeCadVariable(document, variable.id))}
            onDone={() => undefined}
          />
        ))}
        {adding && (
          <VariableRow
            onSave={(name, expression) => apply(setCadVariable(document, { name, expression, folderId }))}
            onDone={() => setAdding(false)}
          />
        )}
      </ul>
    </section>
  );
}
