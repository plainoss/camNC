import { cadPartReferenceName, designStepLabel, designSteps, newCadId, type CadDocument, type CadDrawnOn } from '@wbcnc/cad';
import { useEffect, useMemo, useRef, useState } from 'react';
import { sketchPlaneName } from './drawnOnName';
import { FeatureDialog } from './FeatureDialog';
import { splitPartWith, type SplitPlane } from './splitPart';
import { useDialogPreview } from './useDialogPreview';

/**
 * Split: a part, or one copy of it, cut in two by a plane standing across it. The part keeps one side and the other is
 * a part of its own, listed after it. Its parts box takes the next part clicked; its splitter box the next plane.
 */
export function SplitDialog({
  document,
  partId,
  pick,
  pickPlane,
  onPreview,
  onSave,
  onCancel,
}: {
  document: CadDocument;
  /** The part whose Split is being changed, or none for a new one. */
  partId?: string;
  /** The last part clicked, as a part or copy reference. */
  pick?: { partId: string; seq: number } | null;
  /** Starts picking a plane; the pick comes back once. Null stops it. */
  pickPlane?: (picked: ((on: CadDrawnOn['on'], datum?: string) => void) | null) => void;
  onPreview?: (document: CadDocument | null) => void;
  onSave: (document: CadDocument) => void;
  onCancel: () => void;
}) {
  const existing = partId ? document.parts.find(part => part.id === partId)?.split : undefined;
  const [target, setTarget] = useState<string | null>(existing ? partId! : null);
  const [plane, setPlane] = useState<SplitPlane | null>(
    existing ? { across: existing.across, ...(existing.datum && { datum: existing.datum }) } : null
  );
  // Which box the next click fills: a new Split starts on its parts, then goes on to its splitter.
  const [active, setActive] = useState<'parts' | 'tool' | null>(existing ? null : 'parts');
  const [id] = useState(() => existing?.id ?? newCadId());
  const seen = useRef(pick?.seq);
  const startPlane = () => {
    setActive('tool');
    pickPlane?.((on, datum) => {
      setPlane(datum ? { across: on, datum } : { across: on });
      setActive(null);
    });
  };
  useEffect(() => {
    if (!pick || pick.seq === seen.current) return;
    seen.current = pick.seq;
    if (active !== 'parts' || existing) return;
    setTarget(pick.partId);
    if (!plane) startPlane();
    else setActive(null);
    // A click is taken once, with the boxes as they are then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick]);
  // Closed while picking, the view stops picking. Only on closing: the callback is a new one each time it's given.
  const latestPickPlane = useRef(pickPlane);
  latestPickPlane.current = pickPlane;
  useEffect(() => () => latestPickPlane.current?.(null), []);
  const made = useMemo(() => (target && plane ? splitPartWith(document, target, plane, id) : null), [document, target, plane, id]);
  const problem = made && 'error' in made ? made.error : null;
  useDialogPreview(made && 'document' in made ? made.document : null, onPreview);
  const title =
    (existing && designStepLabel(document, existing.id)) ||
    `Split ${designSteps(document).filter(step => step.kind === 'split').length + 1}`;
  const targetName = target && (cadPartReferenceName(document, target) ?? document.parts.find(part => part.id === target)?.name);
  const planeName =
    plane &&
    (document.planes?.find(candidate => candidate.id === plane.datum)?.name ?? sketchPlaneName(document, { on: plane.across, offset: 0 }));
  const missing = !target ? 'Pick the part to split.' : !plane ? 'Pick a plane to split it with.' : null;
  return (
    <FeatureDialog
      title={title}
      okDisabled={!!missing || !!problem}
      okReason={missing ?? problem}
      failing={problem ?? (target && !plane ? 'Select an entity to split with.' : null)}
      onOk={() => made && 'document' in made && onSave(made.document)}
      onCancel={onCancel}
      acceptFromPartsList>
      {/* Parts are split; splitting faces isn't offered yet. */}
      <div className="cad-feature-tabs cad-static-tabs" role="tablist" aria-label="Split type">
        <span role="tab" aria-selected>
          Part
        </span>
        <span role="tab" aria-selected={false} aria-disabled title="Not available yet">
          Face
        </span>
      </div>
      <div
        className="cad-feature-selection"
        role="group"
        aria-label="Parts, surfaces, or curves to split"
        data-active={active === 'parts' ? '' : undefined}
        onClick={() => !existing && setActive('parts')}>
        <small>Parts, surfaces, or curves to split</small>
        {targetName && <span className="cad-feature-chip">{targetName}</span>}
      </div>
      <div
        className="cad-feature-selection"
        role="group"
        aria-label="Entity to split with"
        data-active={active === 'tool' ? '' : undefined}
        data-missing={target && !plane ? '' : undefined}
        onClick={startPlane}>
        <small>Entity to split with</small>
        {planeName && <span className="cad-feature-chip">{planeName}</span>}
      </div>
      <label title="Not available yet">
        <input type="checkbox" disabled />
        Keep tools
      </label>
      <label title="Not available yet">
        <input type="checkbox" disabled />
        Trim to face boundaries
      </label>
      <label title="Not available yet">
        <input type="checkbox" checked disabled readOnly />
        Keep both sides
      </label>
      {problem && (
        <p role="alert" className="cad-thickness-error">
          {problem}
        </p>
      )}
    </FeatureDialog>
  );
}
