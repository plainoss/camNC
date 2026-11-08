import type { CadDocument, CadPartCut, CadValueScope } from '@wbcnc/cad';
import { useState } from 'react';
import { formatCadValue, parseCadValue } from './valueExpressions';
import './partCutDialog.css';

const kDefaultClearance = '0.2';

/**
 * One "cut parts" step: which parts are cut out of which, with how much room around them. The clearance can use
 * variables, such as a design's tolerance.
 */
export function PartCutDialog({
  document,
  step,
  tool,
  variables,
  onSave,
  onRemove,
  onClose,
}: {
  document: CadDocument;
  /** The step being changed, or none for a new one. */
  step?: CadPartCut;
  /** The part a new step starts out cutting with, such as the selected one. */
  tool?: string;
  variables?: CadValueScope;
  onSave: (change: { tools: string[]; targets: string[]; clearance: number; clearanceExpression?: string }) => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const fit = ['tolerance', 'tollerance', 'clearance', 'fit'].find(name => variables && Object.hasOwn(variables, name));
  const [tools, setTools] = useState<string[]>(step?.tools ?? (tool ? [tool] : []));
  const [targets, setTargets] = useState<string[]>(step?.targets ?? []);
  const [text, setText] = useState(step ? (step.clearanceExpression ?? formatCadValue(step.clearance)) : (fit ?? kDefaultClearance));
  const [error, setError] = useState<string | null>(null);
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter(candidate => candidate !== id) : [...list, id]);
  const save = () => {
    if (!tools.length || !targets.length) return setError('Pick at least one part to cut out, and one to cut it from.');
    if (tools.every(id => targets.every(target => target === id))) return setError('A part can’t be cut out of itself.');
    const parsed = parseCadValue(text, { unit: 'mm', variables });
    if ('error' in parsed) return setError(parsed.error);
    if (parsed.value < 0) return setError('A clearance can’t be less than nothing.');
    onSave({ tools, targets, clearance: parsed.value, clearanceExpression: parsed.expression });
  };
  const list = (label: string, chosen: string[], choose: (ids: string[]) => void) => (
    <fieldset>
      <legend>{label}</legend>
      {document.parts.map(part => (
        <label key={part.id}>
          <input type="checkbox" checked={chosen.includes(part.id)} onChange={() => choose(toggle(chosen, part.id))} />
          {part.name}
        </label>
      ))}
    </fieldset>
  );
  return (
    <div
      className="cad-part-cut-dialog"
      role="dialog"
      aria-label="Cut parts"
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape') onClose();
      }}>
      <h3>Cut parts</h3>
      <p>Cuts the first parts out of the second wherever they reach into them, as when a back sits in a groove.</p>
      {list('Cut these', tools, setTools)}
      {list('out of these', targets, setTargets)}
      <label className="cad-part-cut-clearance">
        Clearance
        <input
          value={text}
          aria-label="Clearance"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          onChange={event => setText(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') save();
          }}
        />
        mm
      </label>
      {error && (
        <p role="alert" className="cad-thickness-error">
          {error}
        </p>
      )}
      <div className="cad-part-cut-actions">
        {onRemove && (
          <button type="button" onClick={onRemove}>
            Delete step
          </button>
        )}
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" onClick={save}>
          {step ? 'Save' : 'Cut'}
        </button>
      </div>
    </div>
  );
}
