import { useDesignUnits } from './designUnits';
import { newCadId, nextDatumName, resolveDatumPlanes, type CadDocument, type CadDrawnOn, type CadValueScope } from '@wbcnc/cad';
import { useEffect, useMemo, useState } from 'react';
import { CadValueInput } from './CadValueInput';
import { sketchPlaneName } from './drawnOnName';
import { FeatureDialog } from './FeatureDialog';
import { useDialogPreview } from './useDialogPreview';

/**
 * A plane to sketch on, as a step of its own: a base plane or a part's face, moved out along its normal by an offset.
 * Parts drawn on it follow it when it changes.
 */
export function PlaneDialog({
  document,
  planeId,
  preselected,
  variables,
  pickPlane,
  onSave,
  onPreview,
  onCancel,
}: {
  document: CadDocument;
  /** The plane being changed, or none for a new one. */
  planeId?: string;
  /** A plane or face picked before the dialog opened, which a new plane starts from. */
  preselected?: CadDrawnOn['on'] | null;
  variables?: CadValueScope;
  /** Starts picking a plane or a face; the pick comes back once. */
  pickPlane?: (picked: (on: CadDrawnOn['on']) => void) => void;
  onSave: (document: CadDocument) => void;
  onPreview?: (document: CadDocument | null) => void;
  onCancel: () => void;
}) {
  const { parseCadValue, lengthText, lengthUnit } = useDesignUnits();
  const plane = document.planes?.find(candidate => candidate.id === planeId);
  const [on, setOn] = useState<CadDrawnOn['on'] | null>(plane?.on ?? preselected ?? null);
  // A negative offset is the plane moved the other way, shown as its distance with the normal flipped, unless it was
  // typed as a negative value of its own, which is kept as typed.
  const typed = plane?.offsetExpression;
  const flippedTyped = typed && /^-\((.*)\)$/.exec(typed)?.[1];
  const [flipped, setFlipped] = useState(!!plane && plane.offset < 0 && (!typed || !!flippedTyped));
  const [offsetText, setOffsetText] = useState(() =>
    !plane ? lengthText(25) : flippedTyped || typed || lengthText(plane.offset < 0 && !typed ? -plane.offset : plane.offset)
  );
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick = () => {
    if (!pickPlane) return;
    setPicking(true);
    pickPlane(picked => {
      setOn(picked);
      setPicking(false);
    });
  };
  // With nothing to offset from yet, the next plane or face clicked is it, as the selection box starts active.
  useEffect(() => {
    if (!on) pick();
    // Only when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [featureId] = useState(() => plane?.id ?? newCadId());
  const [name] = useState(() => plane?.name ?? nextDatumName(document));
  const candidate = useMemo(() => {
    if (!on) return null;
    const offset = parseCadValue(offsetText, { unit: 'mm', variables });
    if ('error' in offset) return null;
    const next = {
      id: featureId,
      name,
      on,
      offset: flipped ? -offset.value : offset.value,
      ...(offset.expression && { offsetExpression: flipped ? `-(${offset.expression})` : offset.expression }),
    };
    const planes = plane
      ? (document.planes ?? []).map(candidate => (candidate.id === plane.id ? next : candidate))
      : [...(document.planes ?? []), next];
    return resolveDatumPlanes({ ...document, revision: document.revision + 1, planes });
  }, [document, plane, featureId, on, offsetText, flipped, name, variables, parseCadValue]);
  useDialogPreview(candidate, onPreview);
  const save = () => {
    if (!on) return setError('Pick a plane or a face to offset from.');
    const offset = parseCadValue(offsetText, { unit: 'mm', variables });
    if ('error' in offset) return setError(offset.error);
    if (candidate) onSave(candidate);
  };
  return (
    <FeatureDialog title={name} onOk={save} onCancel={onCancel}>
      <label className="cad-number-field">
        Plane type
        <select value="offset" disabled title="Not available yet">
          {['Offset', 'Plane point', 'Line angle', 'Point normal', 'Three point', 'Mid plane', 'Curve point', 'Tangent'].map(type => (
            <option key={type} value={type === 'Offset' ? 'offset' : type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="cad-feature-selection"
        aria-label="Entities"
        data-active={picking || !on ? '' : undefined}
        onClick={pick}>
        <small>Entities</small>
        <span>{on ? sketchPlaneName(document, { on, offset: 0 }) : ''}</span>
      </button>
      {/* The distance asks for something to measure it from first. */}
      {on && (
        <>
          <label className="cad-number-field">
            Offset distance
            <span>
              <CadValueInput
                bare
                aria-label="Offset distance"
                value={offsetText}
                spellCheck={false}
                onChange={event => setOffsetText(event.target.value)}
              />
            </span>
            {lengthUnit}
          </label>
          <label>
            <input type="checkbox" checked={flipped} onChange={event => setFlipped(event.target.checked)} />
            Flip normal
          </label>
        </>
      )}
      {error && (
        <p role="alert" className="cad-thickness-error">
          {error}
        </p>
      )}
    </FeatureDialog>
  );
}
