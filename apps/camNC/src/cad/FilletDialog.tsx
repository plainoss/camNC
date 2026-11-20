import { useDesignUnits } from './designUnits';
import { designStepLabel, filletProblems, newCadId, type CadDocument, type CadEdgeFillet, type CadValueScope } from '@wbcnc/cad';
import { useEffect, useMemo, useState } from 'react';
import { CadValueInput } from './CadValueInput';
import { nextFilletLabel } from './drawnOnName';
import { FeatureDialog } from './FeatureDialog';
import { useDialogPreview } from './useDialogPreview';
import type { CadConnectorPick } from './PartFeatureDialogs';
import { pickedOf, pickKey, type Picked } from './edgePicks';

const kUnsupported = 'Not available yet';

/**
 * A Fillet step: edges through a part's thickness, and edges along its faces, picked in the view, rounded to a radius.
 * The part is rounded where it's made, and its sketch keeps its corners.
 */
export function FilletDialog({
  document,
  partId,
  filletId,
  variables,
  pickEdge,
  onSave,
  onPreview,
  onCancel,
}: {
  document: CadDocument;
  /** The part of the fillet being changed; a new one takes the part of the first edge picked. */
  partId?: string;
  filletId?: string;
  variables?: CadValueScope;
  /** Starts picking in the view; the next click on a part comes back once, and null stops it. */
  pickEdge?: (picked: ((pick: CadConnectorPick) => void) | null) => void;
  onSave: (document: CadDocument) => void;
  onPreview?: (document: CadDocument | null) => void;
  onCancel: () => void;
}) {
  const { parseCadValue, lengthText, formatLength, lengthUnit } = useDesignUnits();
  const fillet = document.parts.find(part => part.id === partId)?.fillets?.find(candidate => candidate.id === filletId);
  const [picked, setPicked] = useState<Picked[]>(() =>
    fillet && partId ? [...fillet.corners.map(corner => ({ partId, corner })), ...(fillet.rims ?? []).map(rim => ({ partId, rim }))] : []
  );
  const [radiusText, setRadiusText] = useState(fillet ? (fillet.radiusExpression ?? lengthText(fillet.radius)) : lengthText(5));
  const [error, setError] = useState<string | null>(null);
  // Edges are picked while the dialog is open, one click after another, each toggling its corner.
  useEffect(() => {
    const listen = () =>
      pickEdge?.(pick => {
        const found = pickedOf(document, pick);
        if ('error' in found) setError(found.error);
        else {
          setError(null);
          setPicked(current =>
            current.some(p => pickKey(p) === pickKey(found))
              ? current.filter(p => pickKey(p) !== pickKey(found))
              : current.length && current[0]!.partId !== found.partId
                ? current
                : [...current, found]
          );
        }
        listen();
      });
    listen();
    return () => pickEdge?.(null);
    // The document a pick is read against is the one the dialog opened on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const owner = picked[0]?.partId ?? partId;
  const [featureId] = useState(() => fillet?.id ?? newCadId());
  const candidate = useMemo(() => {
    if (!owner) return null;
    if (!picked.length) {
      if (!fillet) return null;
      // Clear the edited fillet in the preview so its original sharp edges can be selected again.
      return {
        ...document,
        revision: document.revision + 1,
        parts: document.parts.map(part =>
          part.id !== owner ? part : { ...part, fillets: part.fillets?.filter(current => current.id !== fillet.id) }
        ),
      };
    }
    const radius = parseCadValue(radiusText, { unit: 'mm', variables });
    if ('error' in radius || !(radius.value > 0)) return null;
    const rims = picked.flatMap(p => ('rim' in p ? [p.rim] : []));
    const next: CadEdgeFillet = {
      id: featureId,
      corners: picked.flatMap(p => ('corner' in p ? [p.corner] : [])),
      ...(rims.length && { rims }),
      radius: radius.value,
      ...(radius.expression && { radiusExpression: radius.expression }),
    };
    return {
      ...document,
      revision: document.revision + 1,
      parts: document.parts.map(part => {
        if (part.id !== owner) return part;
        const fillets = part.fillets ?? [];
        return { ...part, fillets: fillet ? fillets.map(f => (f.id === fillet.id ? next : f)) : [...fillets, next] };
      }),
    };
  }, [document, radiusText, variables, owner, picked, featureId, fillet, parseCadValue]);
  useDialogPreview(candidate, onPreview);
  // Corners the radius can't take are left sharp where it's made: say so as it's previewed. It can still be kept, marked
  // as broken on its row, as a step with an error can be.
  const owned = candidate?.parts.find(part => part.id === owner);
  const refusal = (candidate && owned && filletProblems(candidate, owned).find(problem => problem.filletId === featureId)?.message) ?? null;
  const save = () => {
    const radius = parseCadValue(radiusText, { unit: 'mm', variables });
    if ('error' in radius) return setError(radius.error);
    if (!(radius.value > 0)) return setError('A fillet needs a radius.');
    if (!owner || !picked.length) return setError('Pick the edges to round.');
    if (candidate) onSave(candidate);
  };
  // An edge is named for the feature that made it, as Edge of Extrude 1, and a face too; where it stands tells picked
  // edges apart. A cut's opening was made by the step that cut it.
  const madeBy = (partId: string, loopId?: string) => {
    const cutBy = loopId?.includes(':cut:') ? loopId.slice(0, loopId.indexOf(':cut:')) : undefined;
    const made = document.parts.find(part => part.id === partId)?.extrudedWith;
    return (
      (cutBy && designStepLabel(document, `${cutBy}:extrude`)) ||
      designStepLabel(document, `${partId}:extrude`) ||
      (made && designStepLabel(document, `${made}:extrude`)) ||
      'a part'
    );
  };
  const edgeName = (pick: Picked) =>
    'rim' in pick
      ? pick.rim.face
        ? `Face of ${madeBy(pick.partId)}`
        : `Edge of ${madeBy(pick.partId, pick.rim.loops[0])}`
      : `Edge of ${madeBy(pick.partId)}`;
  const edgeAt = (pick: Picked, index: number) => {
    if ('rim' in pick) return `on the ${pick.rim.side === 'top' ? 'top' : 'underside'} ${index + 1}`;
    const part = document.parts.find(part => part.id === pick.partId);
    const point = part?.sketch.entities.find(entity => entity.type === 'point' && entity.id === pick.corner);
    return point?.type === 'point' ? `at ${formatLength(point.x)}, ${formatLength(point.y)} ${lengthUnit}` : `${index + 1}`;
  };
  return (
    <FeatureDialog
      // Once an edge is picked the fillet has its place among its part's steps, and the number that goes with it.
      title={designStepLabel(candidate ?? document, featureId) ?? nextFilletLabel(document)}
      okDisabled={!picked.length}
      failing={refusal && /overlap/.test(refusal) ? 'Overlapping fillets.' : refusal}
      onOk={save}
      onCancel={onCancel}>
      <div className="cad-feature-tabs" role="tablist" aria-label="Fillet type">
        {['Edge', 'Full round'].map(choice => (
          <button
            key={choice}
            type="button"
            role="tab"
            aria-selected={choice === 'Edge'}
            disabled={choice !== 'Edge'}
            title={choice === 'Edge' ? undefined : kUnsupported}>
            {choice}
          </button>
        ))}
      </div>
      <div className="cad-feature-selection" data-active="">
        <small>Entities to fillet</small>
        {/* Rounded previews replace the original edges, so each selection also needs an explicit removal control. */}
        {!!picked.length && (
          <ul aria-label="Selected edges" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {picked.map((pick, index) => {
              const label = `${edgeName(pick)} ${edgeAt(pick, index)}`;
              return (
                <li
                  key={`${pick.partId}:${pickKey(pick)}`}
                  style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                  <span title={label}>{edgeName(pick)}</span>
                  <button
                    type="button"
                    aria-label={`Remove selected ${'rim' in pick && pick.rim.face ? 'face' : 'edge'}: ${label}`}
                    onClick={() => {
                      setError(null);
                      setPicked(current => current.filter(edge => edge.partId !== pick.partId || pickKey(edge) !== pickKey(pick)));
                    }}>
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {/* An edge through the board meets its neighbours at a sharp corner, so there's no tangent chain to carry on along. */}
      <label title={kUnsupported}>
        <input type="checkbox" checked disabled readOnly />
        Tangent propagation
      </label>
      <label className="cad-number-field">
        Measurement
        <select value="radius" disabled title={kUnsupported}>
          <option value="radius">Radius</option>
          <option value="distance">Control distance</option>
        </select>
      </label>
      <label className="cad-number-field">
        Radius
        <span>
          <CadValueInput bare aria-label="Radius" value={radiusText} onChange={event => setRadiusText(event.target.value)} />
        </span>
        {lengthUnit}
      </label>
      {['Asymmetric', 'Partial fillet', 'Variable fillet'].map(option => (
        <label key={option} title={kUnsupported}>
          <input type="checkbox" disabled />
          {option}
        </label>
      ))}
      <label title={kUnsupported}>
        <input type="checkbox" checked disabled readOnly />
        Allow edge overflow
      </label>
      <label title={kUnsupported}>
        <input type="checkbox" disabled />
        Smooth fillet corners
      </label>
      {/* A failing round says why on its title and row; only a pick that can't be taken says so here. */}
      {error && (
        <p role="alert" className="cad-thickness-error">
          {error}
        </p>
      )}
    </FeatureDialog>
  );
}
