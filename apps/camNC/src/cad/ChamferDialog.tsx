import { useDesignUnits } from './designUnits';
import {
  designStepLabel,
  filletProblems,
  newCadId,
  type CadDocument,
  type CadEdgeFillet,
  type CadFilletRim,
  type CadValueScope,
} from '@wbcnc/cad';
import { useEffect, useMemo, useState } from 'react';
import { CadValueInput } from './CadValueInput';
import { nextChamferLabel } from './drawnOnName';
import { FeatureDialog } from './FeatureDialog';
import { useDialogPreview } from './useDialogPreview';
import type { CadConnectorPick } from './PartFeatureDialogs';
import { pickedOf, pickKey, type Picked } from './edgePicks';

const kUnsupported = 'Not available yet';
const kThrough = 'A chamfer cuts edges along a part’s top or underside: an edge through the part can’t be chamfered yet.';
const kTypes = ['Equal distance', 'Two distances', 'Distance and angle'] as const;

/** The picked edges as the step's rims: a loop's stretches picked one by one stay one rim, a whole loop wins. */
function rimsOf(picked: Picked[]): CadFilletRim[] {
  const rims = new Map<string, CadFilletRim>();
  for (const pick of picked) {
    if (!('rim' in pick)) continue;
    for (const loop of pick.rim.loops) {
      const key = `${pick.rim.side}\n${loop}`,
        known = rims.get(key);
      const lines = known && (!known.lines || !pick.rim.lines) ? undefined : [...(known?.lines ?? []), ...(pick.rim.lines ?? [])];
      rims.set(key, { side: pick.rim.side, loops: [loop], ...(lines && { lines }) });
    }
  }
  return [...rims.values()];
}

/**
 * A Chamfer step: edges along a part's top or underside, picked in the view one by one or as the face they bound, cut
 * off flat at 45°, the same distance along each face they join.
 */
export function ChamferDialog({
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
  /** The part of the chamfer being changed; a new one takes the part of the first edge picked. */
  partId?: string;
  filletId?: string;
  variables?: CadValueScope;
  /** Starts picking in the view; the next click on a part comes back once, and null stops it. */
  pickEdge?: (picked: ((pick: CadConnectorPick) => void) | null) => void;
  onSave: (document: CadDocument) => void;
  onPreview?: (document: CadDocument | null) => void;
  onCancel: () => void;
}) {
  const { parseCadValue, lengthText, lengthUnit } = useDesignUnits();
  const chamfer = document.parts.find(part => part.id === partId)?.fillets?.find(candidate => candidate.id === filletId);
  const [picked, setPicked] = useState<Picked[]>(() =>
    chamfer && partId
      ? (chamfer.rims ?? []).flatMap(rim =>
          rim.lines ? rim.lines.map(line => ({ partId, rim: { ...rim, lines: [line] } })) : [{ partId, rim }]
        )
      : []
  );
  const [distanceText, setDistanceText] = useState(chamfer ? (chamfer.radiusExpression ?? lengthText(chamfer.radius)) : lengthText(7.5));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const listen = () =>
      pickEdge?.(pick => {
        const found = pickedOf(document, pick, true);
        if ('error' in found) setError(found.error);
        else if ('corner' in found) setError(kThrough);
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
  const [featureId] = useState(() => chamfer?.id ?? newCadId());
  const candidate = useMemo(() => {
    if (!owner) return null;
    if (!picked.length) {
      if (!chamfer) return null;
      return {
        ...document,
        revision: document.revision + 1,
        parts: document.parts.map(part =>
          part.id !== owner ? part : { ...part, fillets: part.fillets?.filter(current => current.id !== chamfer.id) }
        ),
      };
    }
    const distance = parseCadValue(distanceText, { unit: 'mm', variables });
    if ('error' in distance || !(distance.value > 0)) return null;
    const next: CadEdgeFillet = {
      id: featureId,
      corners: [],
      rims: rimsOf(picked),
      radius: distance.value,
      ...(distance.expression && { radiusExpression: distance.expression }),
      chamfer: true,
    };
    return {
      ...document,
      revision: document.revision + 1,
      parts: document.parts.map(part => {
        if (part.id !== owner) return part;
        const fillets = part.fillets ?? [];
        return { ...part, fillets: chamfer ? fillets.map(f => (f.id === chamfer.id ? next : f)) : [...fillets, next] };
      }),
    };
  }, [document, distanceText, variables, owner, picked, featureId, chamfer, parseCadValue]);
  useDialogPreview(candidate, onPreview);
  const owned = candidate?.parts.find(part => part.id === owner);
  const refusal = (candidate && owned && filletProblems(candidate, owned).find(problem => problem.filletId === featureId)?.message) ?? null;
  const save = () => {
    const distance = parseCadValue(distanceText, { unit: 'mm', variables });
    if ('error' in distance) return setError(distance.error);
    if (!(distance.value > 0)) return setError('A chamfer needs a distance.');
    if (!owner || !picked.length) return setError('Pick the edges to chamfer.');
    if (candidate) onSave(candidate);
  };
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
    'rim' in pick && pick.rim.face
      ? `Face of ${madeBy(pick.partId)}`
      : `Edge of ${madeBy(pick.partId, 'rim' in pick ? pick.rim.loops[0] : undefined)}`;
  return (
    <FeatureDialog
      title={designStepLabel(candidate ?? document, featureId) ?? nextChamferLabel(document)}
      okDisabled={!picked.length}
      failing={refusal}
      onOk={save}
      onCancel={onCancel}>
      <div className="cad-feature-selection" data-active="">
        <small>Entities to chamfer</small>
        {!!picked.length && (
          <ul aria-label="Selected edges" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {picked.map((pick, index) => {
              const label = `${edgeName(pick)} ${index + 1}`;
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
      <label title={kUnsupported}>
        <input type="checkbox" checked disabled readOnly />
        Tangent propagation
      </label>
      <label className="cad-number-field">
        Measurement
        <select value="offset" disabled title={kUnsupported}>
          <option value="offset">Offset</option>
        </select>
      </label>
      <label className="cad-number-field">
        Chamfer type
        <select aria-label="Chamfer type" value={kTypes[0]} onChange={() => {}}>
          {kTypes.map(type => (
            <option key={type} value={type} disabled={type !== kTypes[0]} title={type === kTypes[0] ? undefined : kUnsupported}>
              {type}
            </option>
          ))}
        </select>
      </label>
      <label className="cad-number-field">
        Distance
        <span>
          <CadValueInput bare aria-label="Distance" value={distanceText} onChange={event => setDistanceText(event.target.value)} />
        </span>
        {lengthUnit}
      </label>
      {error && (
        <p role="alert" className="cad-thickness-error">
          {error}
        </p>
      )}
    </FeatureDialog>
  );
}
