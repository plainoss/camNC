import { useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import type { CadDocument } from '@wbcnc/cad';
import { PartPatternDialog } from './PartFeatureDialogs';
import { useDialogPreview } from './useDialogPreview';
import { rebasePatternVariableSource } from './studioPatternVariableSource';
import { studioPatternDraft, type PartPatternKind } from './partPatternKind';

type Props = ComponentProps<typeof PartPatternDialog> & {
  owner: object;
  onPreview?: (document: CadDocument | null) => void;
  initialPatternKind?: PartPatternKind;
};
const sameContent = (a: CadDocument, b: CadDocument) => JSON.stringify({ ...a, revision: 0 }) === JSON.stringify({ ...b, revision: 0 });

/** A pattern previews one candidate; acceptance alone publishes its single undoable operation. */
export function StudioPatternDialog({ owner, document, part, onChange, onOk, onCancel, onPreview, initialPatternKind, ...props }: Props) {
  const [opening, setOpening] = useState(() => ({ document, owner }));
  const [draft, setDraft] = useState(() => studioPatternDraft(document, part.id, initialPatternKind));
  const latestDraft = useRef(draft);
  const mounted = useRef(true);
  const completed = useRef(false);
  if (owner === opening.owner && document !== opening.document && !completed.current) {
    const rebased = rebasePatternVariableSource(owner, opening.document, document, latestDraft.current, part.id);
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
      part={draft.parts.find(candidate => candidate.id === part.id)!}
      initiallyPatterned={!!opening.document.parts.find(candidate => candidate.id === part.id)?.pattern}
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
