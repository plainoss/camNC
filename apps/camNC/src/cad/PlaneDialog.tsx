import { newCadId, nextDatumName, resolveDatumPlanes, type CadDocument, type CadDrawnOn, type CadValueScope } from '@wbcnc/cad';
import { useEffect, useMemo, useState } from 'react';
import { CadValueInput } from './CadValueInput';
import { drawnOnName } from './drawnOnName';
import { FeatureDialog } from './FeatureDialog';
import { useDialogPreview } from './useDialogPreview';
import { formatCadValue, parseCadValue } from './valueExpressions';

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
  const plane = document.planes?.find(candidate => candidate.id === planeId);
  const [on, setOn] = useState<CadDrawnOn['on'] | null>(plane?.on ?? preselected ?? null);
  const [offsetText, setOffsetText] = useState(plane ? (plane.offsetExpression ?? formatCadValue(plane.offset)) : '100');
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
  const candidate = useMemo(() => {
    if (!on) return null;
    const offset = parseCadValue(offsetText, { unit: 'mm', variables });
    if ('error' in offset) return null;
    const next = {
      id: featureId,
      name: plane?.name ?? nextDatumName(document),
      on,
      offset: offset.value,
      ...(offset.expression && { offsetExpression: offset.expression }),
    };
    const planes = plane
      ? (document.planes ?? []).map(candidate => (candidate.id === plane.id ? next : candidate))
      : [...(document.planes ?? []), next];
    return resolveDatumPlanes({ ...document, revision: document.revision + 1, planes });
  }, [document, plane, featureId, on, offsetText, variables]);
  useDialogPreview(candidate, onPreview);
  const save = () => {
    if (!on) return setError('Pick a plane or a face to offset from.');
    const offset = parseCadValue(offsetText, { unit: 'mm', variables });
    if ('error' in offset) return setError(offset.error);
    if (candidate) onSave(candidate);
  };
  return (
    <FeatureDialog title={plane ? plane.name : 'Plane'} onOk={save} onCancel={onCancel}>
      <button
        type="button"
        className="cad-feature-selection"
        aria-label="Plane on"
        data-active={picking || !on ? '' : undefined}
        onClick={pick}>
        <small>Offset from</small>
        <span>{on ? drawnOnName(document, on) : 'Pick a plane or a face'}</span>
      </button>
      <label className="cad-number-field">
        Offset
        <span>
          <CadValueInput
            bare
            aria-label="Offset"
            value={offsetText}
            spellCheck={false}
            onChange={event => setOffsetText(event.target.value)}
          />
        </span>
        mm
      </label>
      {error && (
        <p role="alert" className="cad-thickness-error">
          {error}
        </p>
      )}
    </FeatureDialog>
  );
}
