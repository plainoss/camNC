import { extrudeStepProblem, type CadDocument, type CadPart, type CadValueScope } from '@wbcnc/cad';
import { useState } from 'react';
import { CadValueInput } from './CadValueInput';
import { FeatureDialog } from './FeatureDialog';
import { formatCadValue, parseCadValue } from './valueExpressions';

/**
 * A Hole step: a round hole at each point of a sketch drawn on a part's face, as wide as the diameter, through the part
 * or to a depth. Changes show in the view as they're made.
 */
export function HoleDialog({
  document,
  part,
  variables,
  onChange,
  onOk,
  onCancel,
}: {
  document: CadDocument;
  part: CadPart;
  variables?: CadValueScope;
  onChange: (change: (document: CadDocument) => CadDocument) => void;
  onOk: () => void;
  onCancel: () => void;
}) {
  const depth = part.remove?.depth ?? 'through';
  const [diameterText, setDiameterText] = useState(part.hole?.diameterExpression ?? formatCadValue(part.hole?.diameter ?? 5));
  const [depthText, setDepthText] = useState(depth === 'through' ? '10' : (part.remove?.depthExpression ?? formatCadValue(depth)));
  const [error, setError] = useState<string | null>(null);
  const change = (next: (p: CadPart) => CadPart) =>
    onChange(current => ({ ...current, parts: current.parts.map(p => (p.id === part.id ? next(p) : p)) }));
  const apply = (diameter = diameterText, through = depth === 'through', blind = depthText) => {
    const across = parseCadValue(diameter, { unit: 'mm', variables });
    const deep = parseCadValue(blind, { unit: 'mm', variables });
    // A blind depth that can't be used is no reason to refuse a hole through the part.
    const refused =
      'error' in across ? across.error : !(across.value > 0) ? 'A hole needs a diameter.' : !through && 'error' in deep ? deep.error : null;
    setError(refused);
    if (refused || 'error' in across || (!through && 'error' in deep)) return;
    change(p => ({
      ...p,
      hole: { diameter: across.value, ...(across.expression && { diameterExpression: across.expression }) },
      remove:
        through || 'error' in deep
          ? { depth: 'through' }
          : { depth: deep.value, ...(deep.expression && { depthExpression: deep.expression }) },
    }));
  };
  const problem = extrudeStepProblem(document, part);
  return (
    <FeatureDialog title={`Hole · ${part.name}`} okDisabled={!!error || !!problem} onOk={onOk} onCancel={onCancel}>
      <label className="cad-number-field">
        Diameter
        <span>
          <CadValueInput
            bare
            aria-label="Diameter"
            value={diameterText}
            onChange={event => setDiameterText(event.target.value)}
            onBlur={() => apply()}
            onKeyDown={event => event.key === 'Enter' && apply()}
          />
        </span>
        mm
      </label>
      <label className="cad-number-field">
        Termination
        <select
          aria-label="Termination"
          value={depth === 'through' ? 'through' : 'blind'}
          onChange={event => apply(undefined, event.target.value === 'through')}>
          <option value="through">Through</option>
          <option value="blind">Blind</option>
        </select>
      </label>
      {depth !== 'through' && (
        <label className="cad-number-field">
          Depth
          <span>
            <CadValueInput
              bare
              aria-label="Depth"
              value={depthText}
              onChange={event => setDepthText(event.target.value)}
              onBlur={() => apply(undefined, false)}
              onKeyDown={event => event.key === 'Enter' && apply(undefined, false)}
            />
          </span>
          mm
        </label>
      )}
      {(error || problem) && (
        <p role="alert" className="cad-thickness-error">
          {error ?? problem}
        </p>
      )}
    </FeatureDialog>
  );
}
