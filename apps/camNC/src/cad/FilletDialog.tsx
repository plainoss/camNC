import {
  cadDrawnOnSupports,
  effectivePlacement,
  newCadId,
  rotateVector,
  type CadDocument,
  type CadEdgeFillet,
  type CadValueScope,
} from '@wbcnc/cad';
import { useEffect, useState } from 'react';
import { CadValueInput } from './CadValueInput';
import { FeatureDialog } from './FeatureDialog';
import type { CadConnectorPick } from './PartFeatureDialogs';
import { formatCadValue, parseCadValue } from './valueExpressions';

type Picked = { partId: string; corner: string };

/**
 * The sketch corner a picked edge stands on: an edge through a part's thickness is where two of its sides meet. A top or
 * bottom edge can't be rounded with a straight bit, so it says so.
 */
function cornerOf(document: CadDocument, pick: CadConnectorPick): Picked | { error: string } {
  const part = document.parts.find(candidate => candidate.id === pick.partId);
  if (!part || !pick.edge) return { error: 'Click an edge of a part.' };
  if (pick.copy) return { error: 'Pick the edge on the part itself, not on a copy of it.' };
  const at = effectivePlacement(part, cadDrawnOnSupports(document)) ?? { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const back = [-at.rotation[0], -at.rotation[1], -at.rotation[2], at.rotation[3]];
  const local = (p: [number, number, number]) => rotateVector(back, [p[0] - at.position[0], p[1] - at.position[1], p[2] - at.position[2]]);
  const a = local(pick.edge.a),
    b = local(pick.edge.b);
  if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-3)
    return { error: 'Only edges through the board can be rounded: a top or bottom edge needs a roundover bit.' };
  const corner = part.sketch.entities.find(
    entity => entity.type === 'point' && !entity.construction && Math.hypot(entity.x - a[0], entity.y - a[1]) < 1e-3
  );
  return corner ? { partId: part.id, corner: corner.id } : { error: 'That edge isn’t at a corner of the part’s sketch.' };
}

/**
 * A Fillet step: edges through a part's thickness, picked in the view, rounded to a radius. The part is rounded where
 * it's made, and its sketch keeps its corners.
 */
export function FilletDialog({
  document,
  partId,
  filletId,
  variables,
  pickEdge,
  onSave,
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
  onCancel: () => void;
}) {
  const fillet = document.parts.find(part => part.id === partId)?.fillets?.find(candidate => candidate.id === filletId);
  const [picked, setPicked] = useState<Picked[]>(() => (fillet && partId ? fillet.corners.map(corner => ({ partId, corner })) : []));
  const [radiusText, setRadiusText] = useState(fillet ? (fillet.radiusExpression ?? formatCadValue(fillet.radius)) : '5');
  const [error, setError] = useState<string | null>(null);
  // Edges are picked while the dialog is open, one click after another, each toggling its corner.
  useEffect(() => {
    const listen = () =>
      pickEdge?.(pick => {
        const found = cornerOf(document, pick);
        if ('error' in found) setError(found.error);
        else {
          setError(null);
          setPicked(current =>
            current.some(p => p.corner === found.corner)
              ? current.filter(p => p.corner !== found.corner)
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
  const save = () => {
    const radius = parseCadValue(radiusText, { unit: 'mm', variables });
    if ('error' in radius) return setError(radius.error);
    if (!(radius.value > 0)) return setError('A fillet needs a radius.');
    if (!owner || !picked.length) return setError('Pick the edges to round.');
    const next: CadEdgeFillet = {
      id: fillet?.id ?? newCadId(),
      corners: picked.map(p => p.corner),
      radius: radius.value,
      ...(radius.expression && { radiusExpression: radius.expression }),
    };
    onSave({
      ...document,
      revision: document.revision + 1,
      parts: document.parts.map(part => {
        if (part.id !== owner) return part;
        const fillets = part.fillets ?? [];
        return { ...part, fillets: fillet ? fillets.map(f => (f.id === fillet.id ? next : f)) : [...fillets, next] };
      }),
    });
  };
  const name = owner && document.parts.find(part => part.id === owner)?.name;
  return (
    <FeatureDialog title="Fillet" okDisabled={!picked.length} onOk={save} onCancel={onCancel}>
      <div className="cad-feature-selection" data-active="">
        <small>Edges to round</small>
        <span>{picked.length ? `${picked.length} ${picked.length === 1 ? 'edge' : 'edges'} of ${name}` : 'Click edges of a part'}</span>
      </div>
      <label className="cad-number-field">
        Radius
        <span>
          <CadValueInput bare aria-label="Radius" value={radiusText} onChange={event => setRadiusText(event.target.value)} />
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
