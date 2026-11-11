import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { CadDocument } from '@wbcnc/cad';
import { applyCadProposal, cadProposalRefusal, compareCadProposal, type CadProposal } from '@wbcnc/cad-editor/proposal';
import type { CadSession } from '@wbcnc/cad-editor/session';
import './proposal.css';
import { requirementProposalRefusal, subscribeRequirements } from './assistant/requirementStore';
import { ProposalTweaks } from './ProposalTweaks';

const WorkspaceView = lazy(() => import('./WorkspaceView'));
const ignore = () => {};
type Mode = 'before' | 'changes' | 'after';

/** Parts the proposal adds or changes, for highlighting in the Changes view. */
function changedParts(proposal: CadProposal): string[] {
  const before = new Map(proposal.base.parts.map(part => [part.id, JSON.stringify(part)]));
  return proposal.document.parts.filter(part => before.get(part.id) !== JSON.stringify(part)).map(part => part.id);
}

/**
 * Shared by imports, Insert and chat. The review lies over the workspace, below the toolbar and beside the assistant,
 * rather than in a modal window; reviewing never mutates the editing session.
 */
export function ProposalReview({
  proposal,
  session,
  currentDocument,
  disabled,
  onApply,
  onClose,
  onDiscard,
  onReplace,
}: {
  proposal: CadProposal;
  session: CadSession;
  currentDocument: CadDocument;
  disabled?: boolean;
  onApply: (document: CadDocument) => void;
  onClose: () => void;
  onDiscard?: () => void;
  /** A re-checked candidate from review tweaks takes this proposal's place. */
  onReplace?: (proposal: CadProposal) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<Mode>('changes');
  const [rechecking, setRechecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, refreshRequirements] = useState(0);
  useEffect(() => subscribeRequirements(proposal.base.id, () => refreshRequirements(value => value + 1)), [proposal]);
  const comparison = useMemo(() => compareCadProposal(proposal), [proposal]);
  const highlighted = useMemo(() => changedParts(proposal), [proposal]);
  const stale = JSON.stringify(currentDocument) !== JSON.stringify(proposal.base);
  const refusal = disabled
    ? 'Finish or cancel the current edit before applying this design.'
    : (requirementProposalRefusal(proposal) ?? cadProposalRefusal(session, proposal));
  useEffect(() => {
    const element = dialog.current!;
    // Not modal: the toolbar and the assistant stay in view while the person decides.
    element.show();
    element.focus();
    return () => element.close();
  }, []);
  useEffect(() => setError(null), [proposal]);
  const summary = [
    comparison.changed.length && `${comparison.changed.length} changed`,
    comparison.added.length && `${comparison.added.length} added`,
    comparison.removed.length && `${comparison.removed.length} removed`,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <dialog
      ref={dialog}
      className="cad-proposal-review"
      aria-labelledby="cad-proposal-title"
      tabIndex={-1}
      onClose={onClose}
      onKeyDown={event => {
        event.stopPropagation();
        // A non-modal dialog has no built-in Escape; closing keeps the checked proposal for later.
        if (event.key === 'Escape') dialog.current?.close();
      }}>
      <div className="cad-proposal-body">
        <aside aria-label="Changes in this proposal">
          <h2 id="cad-proposal-title">Review design change</h2>
          {(['added', 'changed', 'removed'] as const).map(kind => (
            <section key={kind} data-kind={kind}>
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
        <div className="cad-proposal-view">
          <Suspense fallback={<p>Opening preview…</p>}>
            <WorkspaceView
              document={mode === 'before' ? proposal.base : proposal.document}
              selectedId={null}
              onSelect={ignore}
              onOpen={ignore}
              showPlanes={false}
              highlightIds={mode === 'changes' && highlighted.length ? highlighted : undefined}
            />
          </Suspense>
          {onReplace && (
            <ProposalTweaks
              proposal={proposal}
              currentDocument={currentDocument}
              stale={stale}
              onReplace={onReplace}
              onBusy={setRechecking}
            />
          )}
        </div>
      </div>
      <footer>
        <div className="cad-proposal-modes" role="radiogroup" aria-label="Show">
          {(['before', 'changes', 'after'] as const).map(value => (
            <button key={value} type="button" role="radio" aria-checked={mode === value} onClick={() => setMode(value)}>
              {value === 'before' ? 'Before' : value === 'changes' ? 'Changes' : 'After'}
            </button>
          ))}
        </div>
        <span className="cad-proposal-summary">{summary || 'No step changes'}</span>
        {(refusal || error) && <p role="status">{refusal || error}</p>}
        <span className="cad-proposal-spacer" />
        {onDiscard && (
          <button type="button" onClick={onDiscard}>
            Discard proposal
          </button>
        )}
        <button type="button" onClick={() => dialog.current?.close()}>
          {onDiscard ? 'Close' : 'Discard'}
        </button>
        <button
          type="button"
          className="cad-proposal-apply"
          disabled={!!refusal || rechecking || comparison.errors.length > 0}
          onClick={() => {
            // A host feature preview is not a document change, so the snapshot guard alone cannot detect it.
            if (disabled || rechecking) return;
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
