import { useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import { setPartPattern, type CadDocument, type CadPartPattern } from '@wbcnc/cad';
import { PartPatternDialog } from './PartFeatureDialogs';
import { useDialogPreview } from './useDialogPreview';
import { rebasePatternVariableSource } from './studioPatternVariableSource';
import { studioPatternDraft, type PartPatternKind } from './partPatternKind';
import { useDialogPartPick, type DialogPartPicks } from './useDialogPartPick';

type Props = ComponentProps<typeof PartPatternDialog> & {
  owner: object;
  onPreview?: (document: CadDocument | null) => void;
  initialPatternKind?: PartPatternKind;
  /** Parts clicked while it's open: a new pattern's part field takes them. */
  partPicks?: DialogPartPicks;
};
/** A pattern's settings without what belongs to its own part's copies. */
const movedPattern = ({ id: _id, suppressed: _suppressed, excluded: _excluded, ...pattern }: CadPartPattern) => pattern;
const sameContent = (a: CadDocument, b: CadDocument) => JSON.stringify({ ...a, revision: 0 }) === JSON.stringify({ ...b, revision: 0 });

/** A pattern previews one candidate; acceptance alone publishes its single undoable operation. */
export function StudioPatternDialog({
  owner,
  document,
  part,
  onChange,
  onOk,
  onCancel,
  onPreview,
  initialPatternKind,
  partPicks,
  ...props
}: Props) {
  const [opening, setOpening] = useState(() => ({ document, owner }));
  const [draft, setDraft] = useState(() => studioPatternDraft(document, part.id, initialPatternKind));
  const latestDraft = useRef(draft);
  const mounted = useRef(true);
  const completed = useRef(false);
  // Only a new pattern can move to another part: an existing one belongs to its part's step.
  const partPick = useDialogPartPick({
    document: opening.document,
    partId: part.id,
    picks: partPicks,
    pickable: !opening.document.parts.find(candidate => candidate.id === part.id)?.pattern,
    startActive: true,
    take: (partId, previous) => {
      const target = opening.document.parts.find(candidate => candidate.id === partId);
      if (!target || target.pattern)
        return `${target?.name ?? 'That part'} already has a pattern. Open it from the feature list to change it.`;
      // The pattern set up so far moves to it, on the design as it opened, so the part picked before is left unpatterned.
      const set = latestDraft.current.parts.find(candidate => candidate.id === previous)?.pattern;
      const next = set ? setPartPattern(opening.document, partId, movedPattern(set)) : opening.document;
      latestDraft.current = next;
      setDraft(next);
    },
  });
  const partId = partPick.partId;
  if (owner === opening.owner && document !== opening.document && !completed.current) {
    const rebased = rebasePatternVariableSource(owner, opening.document, document, latestDraft.current, partId);
    if (rebased) {
      latestDraft.current = rebased;
      setDraft(rebased);
      setOpening({ document, owner });
    }
  }
  const valid = document === opening.document && owner === opening.owner;
  const current = useRef({ valid, onChange, onOk, onCancel });
  current.current = { valid, onChange, onOk, onCancel };
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useDialogPreview(valid ? draft : null, onPreview);
  const canPublish = () => mounted.current && !completed.current && current.current.valid;
  return (
    <PartPatternDialog
      {...props}
      document={draft}
      part={draft.parts.find(candidate => candidate.id === partId)!}
      initiallyPatterned={!!opening.document.parts.find(candidate => candidate.id === partId)?.pattern}
      partPick={partPick.pickable ? partPick : null}
      blockedReason={valid ? null : 'The design changed while this pattern was open. Cancel and open the pattern again.'}
      onChange={change => {
        // A picker or field retained by an old dialog must never update a replacement source or another operation.
        if (!canPublish()) return;
        const next = change(latestDraft.current);
        latestDraft.current = next;
        setDraft(next);
      }}
      onOk={() => {
        if (!canPublish()) return;
        completed.current = true;
        const candidate = latestDraft.current;
        if (!sameContent(opening.document, candidate)) current.current.onChange(() => candidate);
        current.current.onOk();
      }}
      onCancel={() => {
        if (!mounted.current || completed.current) return;
        completed.current = true;
        current.current.onCancel();
      }}
    />
  );
}
