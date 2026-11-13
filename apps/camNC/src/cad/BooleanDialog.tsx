import {
  cadDocumentVersion,
  cadPartReferenceName,
  newCadId,
  updatePartCut,
  type CadBooleanOperation,
  type CadDocument,
  type CadPartCut,
} from '@wbcnc/cad';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FeatureDialog } from './FeatureDialog';
import { useDialogPreview } from './useDialogPreview';
import './partCutDialog.css';

type Box = 'tools' | 'targets';

export interface BooleanChange {
  operation: CadBooleanOperation;
  tools: string[];
  targets: string[];
  consumeTools?: true;
}

const kOperations: { id: CadBooleanOperation; label: string }[] = [
  { id: 'union', label: 'Union' },
  { id: 'subtract', label: 'Subtract' },
  { id: 'intersect', label: 'Intersect' },
];

/**
 * One Boolean step: Union joins the parts in Tools into the first of them; Subtract cuts the Tools out of the Targets;
 * Intersect keeps what the Tools share. A new one starts with nothing picked; parts are picked into the active box by
 * clicking them in the view or the parts list. Not kept, the tools are used up.
 */
export function BooleanDialog({
  document,
  step,
  pick,
  onPicked,
  onSave,
  onPreview,
  onRemove,
  onClose,
}: {
  document: CadDocument;
  /** The step being changed, or none for a new one. */
  step?: CadPartCut;
  /** The last part clicked, added to the box being filled or taken out of it. `seq` tells two clicks apart. */
  pick?: { partId: string; seq: number } | null;
  /** The parts in the boxes, for the view to show. */
  onPicked?: (picked: { tools: string[]; targets: string[] }) => void;
  onPreview?: (document: CadDocument | null) => void;
  onSave: (change: BooleanChange) => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const [operation, setOperation] = useState<CadBooleanOperation>(step?.operation ?? 'union');
  // A union's parts are all tools, the first of them the one they're joined into.
  const [tools, setTools] = useState<string[]>(step ? (step.operation === 'subtract' ? step.tools : [...step.targets, ...step.tools]) : []);
  const [targets, setTargets] = useState<string[]>(step?.operation === 'subtract' ? step.targets : []);
  const [active, setActive] = useState<Box>('tools');
  const [keepTools, setKeepTools] = useState(!!step && !step.consumeTools);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef(pick?.seq);
  useEffect(() => {
    if (!pick || pick.seq === seen.current) return;
    seen.current = pick.seq;
    const toggle = (list: string[]) => (list.includes(pick.partId) ? list.filter(id => id !== pick.partId) : [...list, pick.partId]);
    if (active === 'targets' && operation === 'subtract') setTargets(toggle);
    else setTools(toggle);
    setError(null);
  }, [pick, active, operation]);
  useEffect(() => onPicked?.({ tools, targets: operation === 'subtract' ? targets : [] }), [tools, targets, operation, onPicked]);
  const result = useMemo<{ error: string } | { change: BooleanChange }>(() => {
    const consumeTools = keepTools ? undefined : (true as const);
    if (operation === 'subtract') {
      if (!tools.length || !targets.length) return { error: 'Pick the parts to subtract, and the parts to subtract them from.' };
      if (tools.some(id => targets.includes(id))) return { error: 'A part can’t be subtracted from itself.' };
      return { change: { operation, tools, targets, consumeTools } };
    }
    if (tools.length < 2) return { error: 'Pick at least two parts.' };
    if (operation === 'intersect') return { error: 'Intersect isn’t supported yet.' };
    return { change: { operation, targets: tools.slice(0, 1), tools: tools.slice(1), consumeTools } };
  }, [operation, tools, targets, keepTools]);
  const [featureId] = useState(() => step?.id ?? newCadId());
  const candidate = useMemo(() => {
    if ('error' in result) return null;
    if (step) return updatePartCut(document, step.id, { ...result.change, consumeTools: result.change.consumeTools });
    const added: CadPartCut = { id: featureId, clearance: 0, ...result.change };
    if (!added.consumeTools) delete added.consumeTools;
    const next = {
      ...document,
      revision: document.revision + 1,
      partCuts: [...(document.partCuts ?? []), added],
      ...(document.operationOrder && { operationOrder: [...document.operationOrder, featureId] }),
    };
    return { ...next, version: cadDocumentVersion(next) };
  }, [document, result, step, featureId]);
  useDialogPreview(candidate, onPreview);
  const name = (id: string) => cadPartReferenceName(document, id) ?? 'a removed part';
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
      title="Boolean"
      onOk={() => ('error' in result ? setError(result.error) : onSave(result.change))}
      onCancel={onClose}
      className="cad-part-cut-dialog">
      <div className="cad-feature-tabs" role="tablist" aria-label="Boolean type">
        {kOperations.map(choice => (
          <button
            key={choice.id}
            type="button"
            role="tab"
            aria-selected={operation === choice.id}
            onClick={() => {
              setOperation(choice.id);
              setActive('tools');
              setError(null);
            }}>
            {choice.label}
          </button>
        ))}
      </div>
      {operation === 'subtract' && box('targets', 'Targets', targets, setTargets)}
      {box('tools', 'Tools', tools, setTools)}
      <label>
        <input type="checkbox" checked={keepTools} onChange={event => setKeepTools(event.target.checked)} />
        Keep tools
      </label>
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
