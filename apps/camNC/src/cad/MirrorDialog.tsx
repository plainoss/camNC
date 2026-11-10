import { addPartMirror, cadMirrorPlaneWouldCycle, type CadDocument, type CadDrawnOn, type CadPartCopy } from '@wbcnc/cad';
import { useEffect, useState } from 'react';
import { drawnOnName } from './drawnOnName';
import { FeatureDialog } from './FeatureDialog';

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
  onCancel,
}: {
  document: CadDocument;
  partId: string;
  /** The mirror image being changed, or none for a new one. */
  copyId?: string;
  /** Starts picking a plane or a face; the pick comes back once. */
  pickPlane?: (picked: (on: CadDrawnOn['on'], datum?: string) => void) => void;
  onSave: (document: CadDocument) => void;
  onCancel: () => void;
}) {
  const part = document.parts.find(candidate => candidate.id === partId);
  const copy = part?.copies?.find(candidate => candidate.id === copyId);
  const [across, setAcross] = useState<Across | null>(copy?.mirror ?? null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const save = () => {
    if (!part || !across) return;
    if (!copy) return onSave(addPartMirror(document, part.id, across).document);
    onSave({
      ...document,
      revision: document.revision + 1,
      parts: document.parts.map(candidate =>
        candidate.id !== part.id
          ? candidate
          : { ...candidate, copies: candidate.copies!.map(c => (c.id === copy.id ? { ...c, mirror: across } : c)) }
      ),
    });
  };
  return (
    <FeatureDialog title="Mirror" okDisabled={!across || !part || !!error} onOk={save} onCancel={onCancel}>
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
      {error && <p role="alert">{error}</p>}
    </FeatureDialog>
  );
}
