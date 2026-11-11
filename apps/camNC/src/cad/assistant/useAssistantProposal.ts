import { useEffect, useRef, useState } from 'react';
import type { CadDocument } from '@wbcnc/cad';
import type { CadProposal } from '@wbcnc/cad-editor/proposal';
import { recordAssistantEvent } from './conversationStore';

/** Checked candidates outlive the dock and its preview; only an explicit outcome consumes them. */
export function useAssistantProposal(document: CadDocument) {
  const [pending, setPending] = useState<CadProposal | null>(null);
  const applied = useRef<CadProposal | null>(null);
  const proposal = pending?.base.id === document.id ? pending : null;
  useEffect(() => {
    const previous = applied.current;
    if (!previous || previous.base.id !== document.id) return;
    // Undo changes the session revision, so compare content without its history counter.
    const { revision: _beforeRevision, ...before } = previous.base;
    const { revision: _currentRevision, ...current } = document;
    if (JSON.stringify(before) === JSON.stringify(current)) {
      recordAssistantEvent(
        document.id,
        'The applied proposal was undone: the open design matches its pre-proposal content. Earlier user constraints still apply.'
      );
      applied.current = null;
    }
  }, [document]);
  return {
    proposal,
    receive: setPending,
    discard: () => {
      if (!proposal) return;
      setPending(null);
      recordAssistantEvent(document.id, 'The user discarded the checked proposal. It was not applied.', 'discarded');
    },
    markApplied: (candidate: CadProposal) => {
      applied.current = candidate;
      setPending(null);
      recordAssistantEvent(
        document.id,
        'The user applied the checked proposal as one undo step. The next open-design context is authoritative.',
        'applied'
      );
    },
  };
}

export type AssistantProposalState = ReturnType<typeof useAssistantProposal>;
