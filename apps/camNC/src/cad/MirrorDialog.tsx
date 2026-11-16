import {
  designStepLabel,
  designSteps,
  evaluateCadPart,
  newCadId,
  numberedCadCopy,
  resolvePartPatterns,
  cadMirrorPlaneFrame,
  cadMirrorPlaneWouldCycle,
  type CadDocument,
  type CadDrawnOn,
  type CadMirrorJoin,
  type CadPart,
  type CadPartCopy,
} from '@wbcnc/cad';
import { useEffect, useMemo, useState } from 'react';
import { sketchPlaneName } from './drawnOnName';
import { DialogPartField } from './DialogPartField';
import { useDialogPartPick, type DialogPartPicks } from './useDialogPartPick';
import { FeatureDialog } from './FeatureDialog';
import { useDialogPreview } from './useDialogPreview';

type Across = NonNullable<CadPartCopy['mirror']>;

/**
 * A mirror image of a part across a plane, a part's face or a plane made to sketch on, as a step of its own. It stays
 * the part's mirror image as the part or the plane moves. Editing one changes the plane it's mirrored across.
 */
export function MirrorDialog({
  document,
  partId: openedFor,
  copyId,
  joinId,
  partPicks,
  pickPlane,
  onSave,
  onPreview,
  onCancel,
}: {
  document: CadDocument;
  partId: string;
  /** The mirror image being changed, or none for a new one. */
  copyId?: string;
  /** The Mirror › Add being changed: the part joined with its mirror image. */
  joinId?: string;
  /** Parts clicked while it's open: a new mirror's part field takes them. */
  partPicks?: DialogPartPicks;
  /** Starts picking a plane or a face; the pick comes back once. Null stops it. */
  pickPlane?: (picked: ((on: CadDrawnOn['on'], datum?: string) => void) | null) => void;
  onSave: (document: CadDocument) => void;
  onPreview?: (document: CadDocument | null) => void;
  onCancel: () => void;
}) {
  // The mirror plane is picked first; clicking the part field then takes the next part clicked. Once a part is taken,
  // a mirror still without a plane goes on to pick it, so a plane clicked next is the mirror's, not a new selection.
  const partPick = useDialogPartPick({
    document,
    partId: openedFor,
    picks: partPicks,
    pickable: !copyId && !joinId,
    startActive: false,
    take: (): void => {
      if (!across) pick();
    },
  });
  const partId = partPick.partId;
  const part = document.parts.find(candidate => candidate.id === partId);
  const copy = part?.copies?.find(candidate => candidate.id === copyId);
  const join = part?.mirrorJoins?.find(candidate => candidate.id === joinId);
  const [across, setAcross] = useState<Across | null>(
    copy?.mirror ?? (join ? (join.datum ? { across: join.across, datum: join.datum } : { across: join.across }) : null)
  );
  // New makes a mirror image of its own; Add joins it to the part. A new mirror goes to Add once its image touches the part.
  const [operation, setOperation] = useState<'New' | 'Add' | null>(join ? 'Add' : copy ? 'New' : null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Automatic display positions are not persisted; an unresolved face must never create a stale or unplaced mirror.
  const frame = across && cadMirrorPlaneFrame(document, across);
  const planeError = across && (!frame ? 'That plane cannot be resolved.' : 'error' in frame ? frame.error : null);
  const issue = error ?? planeError;
  const pick = () => {
    if (!pickPlane) return;
    partPick.deactivate();
    setPicking(true);
    pickPlane((on, datum) => {
      // A copy cannot define its own mirror plane: regeneration would keep reflecting it about its previous position.
      if (copyId && cadMirrorPlaneWouldCycle(document, partId, copyId, on)) {
        setError('Choose a face that does not depend on this mirror.');
        setPicking(false);
        return;
      }
      setError(null);
      setAcross(datum ? { across: on, datum } : { across: on });
      setPicking(false);
    });
  };
  // The mirror plane is picked first, as its selection box starts active.
  useEffect(() => {
    if (!across) pick();
    // Only when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const name =
    across &&
    (document.planes?.find(plane => plane.id === across.datum)?.name ?? sketchPlaneName(document, { on: across.across, offset: 0 }));
  const [featureId] = useState(() => copy?.id ?? join?.id ?? newCadId());
  const joined = useMemo(() => {
    if (!part || !across || issue || copy) return null;
    const next: CadMirrorJoin = { id: featureId, across: across.across, ...(across.datum && { datum: across.datum }) };
    const mirrorJoins = join ? part.mirrorJoins!.map(j => (j.id === join.id ? next : j)) : [...(part.mirrorJoins ?? []), next];
    return resolvePartPatterns({
      ...document,
      revision: document.revision + 1,
      parts: document.parts.map(candidate => (candidate.id !== part.id ? candidate : { ...candidate, mirrorJoins })),
    });
  }, [document, part, copy, join, featureId, across, issue]);
  const chosen = operation ?? (joined && touchesItsImage(joined, part!.id, featureId) ? 'Add' : 'New');
  const candidate = useMemo(() => {
    if (chosen === 'Add') return joined;
    if (!part || !across || issue) return null;
    // A new mirror takes the next free number, so it doesn't renumber the part's other copies.
    const nextCopy: CadPartCopy = { ...(copy ?? numberedCadCopy(part, { id: featureId, mirrored: true })), mirror: across };
    return resolvePartPatterns({
      ...document,
      revision: document.revision + 1,
      parts: document.parts.map(candidate =>
        candidate.id !== part.id
          ? candidate
          : {
              ...candidate,
              copies: copy ? candidate.copies!.map(c => (c.id === copy.id ? nextCopy : c)) : [...(candidate.copies ?? []), nextCopy],
            }
      ),
    });
  }, [document, part, copy, featureId, across, issue, chosen, joined]);
  useDialogPreview(candidate, onPreview);
  const save = () => {
    if (candidate) onSave(candidate);
  };
  const title =
    designStepLabel(document, join?.id ?? '') ?? `Mirror ${designSteps(document).filter(step => step.kind === 'mirror').length + 1}`;
  return (
    <FeatureDialog title={title} okDisabled={!across || !part || !!issue} onOk={save} onCancel={onCancel} acceptFromPartsList>
      <div className="cad-feature-tabs" role="tablist" aria-label="Mirror operation">
        {(['New', 'Add', 'Remove', 'Intersect'] as const).map(choice => (
          <button
            key={choice}
            type="button"
            role="tab"
            aria-selected={choice === chosen}
            // An existing step stays what it is; Remove and Intersect need a solid kernel.
            disabled={(choice !== 'New' && choice !== 'Add') || ((!!copy || !!join) && choice !== chosen)}
            title={choice === 'Remove' || choice === 'Intersect' ? 'Not available yet' : undefined}
            onClick={() => setOperation(choice as 'New' | 'Add')}>
            {choice}
          </button>
        ))}
      </div>
      <DialogPartField
        label="Entities to mirror"
        name={part?.name ?? 'Select a part'}
        pick={copyId || joinId ? null : partPick}
        onActivate={() => {
          setPicking(false);
          pickPlane?.(null);
          partPick.activate();
        }}
      />
      <button
        type="button"
        className="cad-feature-selection"
        aria-label="Mirror plane"
        data-active={(picking || !across) && !partPick.active ? '' : undefined}
        onClick={pick}>
        <small>Mirror plane</small>
        <span>{name ?? ''}</span>
      </button>
      {chosen === 'Add' && (
        <>
          <label title="Not available yet">
            <input type="checkbox" disabled />
            Merge with all
          </label>
          <div className="cad-feature-selection">
            <small>Merge scope</small>
            <span>{part?.name ?? ''}</span>
          </div>
        </>
      )}
      {issue && <p role="alert">{issue}</p>}
    </FeatureDialog>
  );
}

/** Whether a part's mirror image, as `joined` lays it out, touches or overlaps the part where it is. */
function touchesItsImage(joined: CadDocument, partId: string, joinId: string): boolean {
  const part = joined.parts.find(candidate => candidate.id === partId);
  const line = part?.mirrorJoins?.find(candidate => candidate.id === joinId)?.line;
  if (!part || !line) return false;
  // As the part is made just before this mirror: with the ones before it, without it and those after.
  const joins = part.mirrorJoins!;
  const before = joins.slice(
    0,
    joins.findIndex(candidate => candidate.id === joinId)
  );
  const { mirrorJoins: _joins, ...plain } = part as CadPart;
  const outline = evaluateCadPart(before.length ? { ...plain, mirrorJoins: before } : plain).part?.outline ?? [];
  const side = outline.map(p => (p.x - line.x) * line.nx + (p.y - line.y) * line.ny);
  return side.some(d => Math.abs(d) < 1e-6) || (side.some(d => d > 0) && side.some(d => d < 0));
}
