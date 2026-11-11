import {
  newCadId,
  numberedCadCopy,
  resolvePartPatterns,
  cadMirrorPlaneFrame,
  cadMirrorPlaneWouldCycle,
  type CadDocument,
  type CadDrawnOn,
  type CadPartCopy,
} from '@wbcnc/cad';
import { useEffect, useMemo, useState } from 'react';
import { drawnOnName } from './drawnOnName';
import { FeatureDialog } from './FeatureDialog';
import { useDialogPreview } from './useDialogPreview';

type Across = NonNullable<CadPartCopy['mirror']>;

/**
 * A mirror image of a part across a plane, a part's face or a plane made to sketch on, as a step of its own. It stays
 * the part's mirror image as the part or the plane moves. Editing one changes the plane it's mirrored across.
 */
export function MirrorDialog({
  document,
  partId,
  copyId,
  pickPlane,
  onSave,
  onPreview,
  onCancel,
}: {
  document: CadDocument;
  partId: string;
  /** The mirror image being changed, or none for a new one. */
  copyId?: string;
  /** Starts picking a plane or a face; the pick comes back once. */
  pickPlane?: (picked: (on: CadDrawnOn['on'], datum?: string) => void) => void;
  onSave: (document: CadDocument) => void;
  onPreview?: (document: CadDocument | null) => void;
  onCancel: () => void;
}) {
  const part = document.parts.find(candidate => candidate.id === partId);
  const copy = part?.copies?.find(candidate => candidate.id === copyId);
  const [across, setAcross] = useState<Across | null>(copy?.mirror ?? null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Automatic display positions are not persisted; an unresolved face must never create a stale or unplaced mirror.
  const frame = across && cadMirrorPlaneFrame(document, across);
  const planeError = across && (!frame ? 'That plane cannot be resolved.' : 'error' in frame ? frame.error : null);
  const issue = error ?? planeError;
  const pick = () => {
    if (!pickPlane) return;
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
  const name = across && (document.planes?.find(plane => plane.id === across.datum)?.name ?? drawnOnName(document, across.across));
  const [featureId] = useState(() => copy?.id ?? newCadId());
  const candidate = useMemo(() => {
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
  }, [document, part, copy, featureId, across, issue]);
  useDialogPreview(candidate, onPreview);
  const save = () => {
    if (candidate) onSave(candidate);
  };
  return (
    <FeatureDialog title="Mirror" okDisabled={!across || !part || !!issue} onOk={save} onCancel={onCancel}>
      <div className="cad-feature-selection">
        <small>Entities to mirror</small>
        <span>{part?.name ?? 'Select a part'}</span>
      </div>
      <button
        type="button"
        className="cad-feature-selection"
        aria-label="Mirror plane"
        data-active={picking || !across ? '' : undefined}
        onClick={pick}>
        <small>Mirror plane</small>
        <span>{name ?? 'Pick a plane or a face'}</span>
      </button>
      {issue && <p role="alert">{issue}</p>}
    </FeatureDialog>
  );
}
