import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { CadDocument } from '@wbcnc/cad';
import { applyCadProposal, cadProposalRefusal, compareCadProposal, type CadProposal } from '@wbcnc/cad-editor/proposal';
import type { CadSession } from '@wbcnc/cad-editor/session';
import './proposal.css';
import { requirementProposalRefusal, subscribeRequirements } from './assistant/requirementStore';

const WorkspaceView = lazy(() => import('./WorkspaceView'));
const ignore = () => {};

/** Shared by imports, Insert and chat: reviewing changes never mutates the editing session. */
export function ProposalReview({
  proposal,
  session,
  currentDocument,
  disabled,
  onApply,
  onClose,
}: {
  proposal: CadProposal;
  session: CadSession;
  currentDocument: CadDocument;
  disabled?: boolean;
  onApply: (document: CadDocument) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [original, setOriginal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, refreshRequirements] = useState(0);
  useEffect(() => subscribeRequirements(proposal.base.id, () => refreshRequirements(value => value + 1)), [proposal]);
  const comparison = useMemo(() => compareCadProposal(proposal), [proposal]);
  const refusal = disabled
    ? 'Finish or cancel the current edit before applying this design.'
    : (requirementProposalRefusal(proposal) ?? cadProposalRefusal(session, proposal));
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  // currentDocument makes stale checks run whenever the mounted editor publishes a hand edit.
  void currentDocument;
  return (
    <dialog
      ref={dialog}
      className="cad-proposal-review"
      aria-labelledby="cad-proposal-title"
      onClose={onClose}
      onKeyDown={event => event.stopPropagation()}>
      <header>
        <h2 id="cad-proposal-title">Review design change</h2>
        <button type="button" onClick={() => dialog.current?.close()} autoFocus>
          Discard
        </button>
      </header>
      <div className="cad-proposal-body">
        <div className="cad-proposal-view">
          <button type="button" aria-pressed={original} onClick={() => setOriginal(value => !value)}>
            {original ? 'Show proposed design' : 'Show original design'}
          </button>
          <Suspense fallback={<p>Opening preview…</p>}>
            <WorkspaceView
              document={original ? proposal.base : proposal.document}
              selectedId={null}
              onSelect={ignore}
              onOpen={ignore}
              showPlanes={false}
            />
          </Suspense>
        </div>
        <aside aria-label="Changes in this proposal">
          {(['added', 'changed', 'removed'] as const).map(kind => (
            <section key={kind}>
              <h3>
                {kind[0].toUpperCase() + kind.slice(1)} ({comparison[kind].length})
              </h3>
              <ul>
                {comparison[kind].map(step => (
                  <li key={step.id}>{step.label}</li>
                ))}
              </ul>
            </section>
          ))}
          <h3>Cost of this change</h3>
          {comparison.costs.length ? (
            <ul>
              {comparison.costs.map(cost => (
                <li key={cost}>{cost}</li>
              ))}
            </ul>
          ) : (
            <p>No lost cuts or joints detected.</p>
          )}
          {comparison.newWarnings.length > 0 && (
            <>
              <h3>New warnings</h3>
              <ul>
                {comparison.newWarnings.map(warning => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </>
          )}
          {comparison.errors.length > 0 && (
            <>
              <h3>Needs repair</h3>
              <ul>
                {comparison.errors.map(message => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
      <footer>
        {(refusal || error) && <p role="status">{refusal || error}</p>}
        <button
          type="button"
          disabled={!!refusal || comparison.errors.length > 0}
          onClick={() => {
            // A host feature preview is not a document change, so the snapshot guard alone cannot detect it.
            if (disabled) return;
            try {
              const changedRequirements = requirementProposalRefusal(proposal);
              if (changedRequirements) throw new Error(changedRequirements);
              onApply(applyCadProposal(session, proposal));
              dialog.current?.close();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Unable to apply this proposal.');
            }
          }}>
          Apply as one undo step
        </button>
      </footer>
    </dialog>
  );
}
