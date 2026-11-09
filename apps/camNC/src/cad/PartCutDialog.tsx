import type { CadDocument, CadPartCut, CadValueScope } from '@wbcnc/cad';
import { useEffect, useRef, useState } from 'react';
import { FeatureDialog } from './FeatureDialog';
import { formatCadValue, parseCadValue } from './valueExpressions';
import './partCutDialog.css';
import { CadValueInput } from './CadValueInput';

const kDefaultClearance = '0.2';

type Box = 'tools' | 'targets';
type Joint = 'none' | 'half' | 'fingers';

/**
 * One "cut parts" step, as the reference's subtracting boolean: the parts that cut (tools) and the parts they're cut
 * out of (targets), each picked into its box by clicking parts in the view or the parts list, and how much room is
 * left around them. The clearance can use variables, such as a design's tolerance.
 */
export function PartCutDialog({
  document,
  step,
  tool,
  variables,
  pick,
  onPicked,
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
  /** The last part clicked, added to the box being filled or taken out of it. `seq` tells two clicks apart. */
  pick?: { partId: string; seq: number } | null;
  /** The parts in both boxes, for the view to show. */
  onPicked?: (picked: { tools: string[]; targets: string[] }) => void;
  onSave: (change: {
    tools: string[];
    targets: string[];
    clearance: number;
    clearanceExpression?: string;
    split?: CadPartCut['split'];
    consumeTools?: true;
  }) => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const fit = ['tolerance', 'tollerance', 'clearance', 'fit'].find(name => variables && Object.hasOwn(variables, name));
  const [tools, setTools] = useState<string[]>(step?.tools ?? (tool ? [tool] : []));
  const [targets, setTargets] = useState<string[]>(step?.targets ?? []);
  // A new step has its tool already, so the targets are picked next.
  const [active, setActive] = useState<Box>(step || !tool ? 'tools' : 'targets');
  const [text, setText] = useState(step ? (step.clearanceExpression ?? formatCadValue(step.clearance)) : (fit ?? kDefaultClearance));
  // Kept, the tools stay parts of their own, as a tenon does; not kept, only the cut they make is left.
  const [keepTools, setKeepTools] = useState(!step?.consumeTools);
  const [joint, setJoint] = useState<Joint>(step?.split === 'half' ? 'half' : step?.split ? 'fingers' : 'none');
  const [fingersText, setFingersText] = useState(
    step?.split && typeof step.split === 'object' ? (step.split.fingersExpression ?? String(step.split.fingers)) : '5'
  );
  const fingers = parseCadValue(fingersText, { unit: 'scalar', variables });
  const fingersError =
    joint !== 'fingers'
      ? null
      : 'error' in fingers
        ? fingers.error
        : !Number.isInteger(fingers.value) || fingers.value < 2
          ? 'Use a whole number of fingers, at least 2.'
          : null;
  const [error, setError] = useState<string | null>(null);
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter(candidate => candidate !== id) : [...list, id]);
  const seen = useRef(pick?.seq);
  useEffect(() => {
    if (!pick || pick.seq === seen.current) return;
    seen.current = pick.seq;
    if (active === 'tools') setTools(list => toggle(list, pick.partId));
    else setTargets(list => toggle(list, pick.partId));
    setError(null);
  }, [pick, active]);
  useEffect(() => onPicked?.({ tools, targets }), [tools, targets, onPicked]);
  const save = () => {
    if (!tools.length || !targets.length) return setError('Pick at least one part to cut out, and one to cut it from.');
    if (tools.every(id => targets.every(target => target === id))) return setError('A part can’t be cut out of itself.');
    const parsed = parseCadValue(text, { unit: 'mm', variables });
    if ('error' in parsed) return setError(parsed.error);
    if (parsed.value < 0) return setError('A clearance can’t be less than nothing.');
    if (fingersError) return;
    const split: CadPartCut['split'] =
      joint === 'half'
        ? 'half'
        : joint === 'fingers' && !('error' in fingers)
          ? { fingers: fingers.value, ...(fingers.expression && { fingersExpression: fingers.expression }) }
          : undefined;
    onSave({
      tools,
      targets,
      clearance: parsed.value,
      clearanceExpression: parsed.expression,
      split,
      consumeTools: !split && !keepTools ? true : undefined,
    });
  };
  const name = (id: string) => document.parts.find(part => part.id === id)?.name ?? 'a removed part';
  const box = (which: Box, label: string, chosen: string[], choose: (ids: string[]) => void) => (
    <div
      className="cad-feature-selection cad-part-cut-box"
      role="group"
      aria-label={label}
      data-active={active === which || undefined}
      onClick={() => setActive(which)}>
      <small>{label}</small>
      {chosen.length ? (
        <ul>
          {chosen.map(id => (
            <li key={id}>
              {name(id)}
              <button
                type="button"
                aria-label={`Take ${name(id)} out of ${label.toLowerCase()}`}
                onClick={event => {
                  event.stopPropagation();
                  choose(chosen.filter(candidate => candidate !== id));
                }}>
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <span className="cad-feature-hint">{active === which ? 'Click parts in the view or the parts list' : 'None yet'}</span>
      )}
    </div>
  );
  return (
    <FeatureDialog
      title="Cut parts"
      okLabel={step ? 'Save' : 'Cut'}
      okDisabled={!!fingersError}
      onOk={save}
      onCancel={onClose}
      className="cad-part-cut-dialog">
      {box('tools', 'Tools', tools, setTools)}
      {box('targets', 'Targets', targets, setTargets)}
      <label className="cad-part-cut-clearance">
        Clearance
        <CadValueInput
          bare
          value={text}
          aria-label="Clearance"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          onChange={event => setText(event.target.value)}
        />
        mm
      </label>
      {joint === 'none' && (
        <label>
          <input type="checkbox" checked={keepTools} onChange={event => setKeepTools(event.target.checked)} />
          Keep tools
        </label>
      )}
      <label>
        Joint
        <select value={joint} onChange={event => setJoint(event.target.value as Joint)}>
          <option value="none">Cut out</option>
          <option value="half">Half lap</option>
          <option value="fingers">Finger joint</option>
        </select>
      </label>
      {joint !== 'none' && <p className="cad-feature-hint">Both parts are kept.</p>}
      {joint === 'fingers' && (
        <label className="cad-part-cut-clearance">
          Fingers
          <CadValueInput
            bare
            value={fingersText}
            aria-label="Fingers"
            spellCheck={false}
            aria-invalid={fingersError ? true : undefined}
            aria-describedby={fingersError ? 'cad-part-cut-fingers-error' : undefined}
            onChange={event => setFingersText(event.target.value)}
          />
        </label>
      )}
      {fingersError && (
        <p id="cad-part-cut-fingers-error" role="alert" className="cad-thickness-error">
          {fingersError}
        </p>
      )}
      {error && (
        <p role="alert" className="cad-thickness-error">
          {error}
        </p>
      )}
      {onRemove && (
        <div className="cad-part-cut-actions">
          <button type="button" onClick={onRemove}>
            Delete step
          </button>
        </div>
      )}
    </FeatureDialog>
  );
}
