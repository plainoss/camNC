import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { assemblyReport, evaluateCadDocument, type CadDocument } from '@wbcnc/cad';
import { cupboard, editCad, inspectCadDocument } from '@wbcnc/cad-script';
import { cadProposal, type CadProposal } from '@wbcnc/cad-editor/proposal';
import type { CadSession } from '@wbcnc/cad-editor/session';
import { ProposalReview } from './ProposalReview';
import { assistantSelection } from './assistant/selection';
import { recordAssistantEvent } from './assistant/conversationStore';
import './assistant/dock.css';

const AssistantDock = lazy(() => import('./assistant/Dock').then(module => ({ default: module.AssistantDock })));

/** Small editor entry point; all candidate state stays outside the editor's commands and saved design. */
export function StudioProposals({
  document,
  session,
  selection,
  disabled,
  onApply,
}: {
  document: CadDocument;
  session: CadSession;
  selection?: { partId: string; copyId?: string };
  disabled?: boolean;
  onApply: (document: CadDocument) => void;
}) {
  const [assistant, setAssistant] = useState(false);
  const [proposal, setProposal] = useState<CadProposal | null>(null);
  const assistantProposal = useRef<CadProposal | null>(null);
  const appliedProposal = useRef<CadProposal | null>(null);
  useEffect(() => {
    const applied = appliedProposal.current;
    if (!applied || applied.base.id !== document.id) return;
    // Undo changes the session revision, so compare document content without its history counter.
    const { revision: _beforeRevision, ...before } = applied.base;
    const { revision: _currentRevision, ...current } = document;
    if (JSON.stringify(before) === JSON.stringify(current)) {
      recordAssistantEvent(
        document.id,
        'The applied proposal was undone: the open design matches its pre-proposal content. Earlier user constraints still apply.'
      );
      appliedProposal.current = null;
    }
  }, [document]);
  const [error, setError] = useState('');
  const [building, setBuilding] = useState(false);
  const tools = useRef<HTMLDivElement>(null);
  const [overlayHost, setOverlayHost] = useState<Element | null>(null);
  // Keep overlays outside the toolbar's stacking context and nowrap action group.
  useEffect(() => setOverlayHost(tools.current?.closest('.cad-editor') ?? null), []);
  const insert = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [sizes, setSizes] = useState({ width: 600, height: 720, depth: 300, board: 18, shelves: 3 });
  const reviewFile = async (file: File) => {
    if (building || disabled) return;
    const start = structuredClone(document);
    setBuilding(true);
    setError('');
    setProposal(null);
    try {
      const candidate = cadProposal(start, JSON.parse(await file.text()));
      // Saved coordinates can lag behind their constraints. Review exactly the solved geometry Apply will keep.
      const checked = await inspectCadDocument(candidate.document);
      if (!checked.report.ok)
        throw new Error(checked.report.errors.map(error => error.message).join('\n') || 'Fix this design before reviewing it.');
      setProposal(cadProposal(start, checked.document));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to read this design.');
    } finally {
      setBuilding(false);
    }
  };
  const build = async () => {
    const start = structuredClone(document);
    setBuilding(true);
    setError('');
    try {
      const evaluated = evaluateCadDocument(start);
      const assembly = assemblyReport(start, evaluated.parts);
      const x = Math.max(0, ...(assembly?.parts.map(part => part.at[0]! + part.size[0]!) ?? []));
      const result = await editCad(
        start,
        cupboard({
          name: 'Cupboard',
          width: `${sizes.width}mm`,
          height: `${sizes.height}mm`,
          depth: `${sizes.depth}mm`,
          board: `${sizes.board}mm`,
          shelves: sizes.shelves,
          at: [start.parts.length ? x + 100 : 0, 0, 0],
        })
      );
      if (!result.ok) throw new Error(result.scriptError ?? result.report.errors.map(error => error.message).join('\n'));
      insert.current?.close();
      setProposal(cadProposal(start, result.document));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to build this cupboard.');
    } finally {
      setBuilding(false);
    }
  };
  return (
    <>
      <div ref={tools} className="cad-proposal-tools" aria-label="Insert and assistant">
        <details className="cad-insert-menu">
          <summary>Insert</summary>
          <div>
            <button
              type="button"
              disabled={disabled || building}
              onClick={event => {
                event.currentTarget.closest('details')?.removeAttribute('open');
                setError('');
                insert.current?.showModal();
              }}>
              Cupboard…
            </button>
            <button
              type="button"
              disabled={disabled || building}
              onClick={event => {
                event.currentTarget.closest('details')?.removeAttribute('open');
                input.current?.click();
              }}>
              Review design file…
            </button>
          </div>
        </details>
        <button
          type="button"
          className="cad-assistant-toggle"
          aria-label="Assistant"
          aria-pressed={assistant}
          disabled={disabled}
          onClick={() => setAssistant(value => !value)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 4h16v12H9l-5 4V4Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span>Assistant</span>
        </button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          disabled={disabled || building}
          hidden
          onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void reviewFile(file);
          }}
        />
        {error && !insert.current?.open && (
          <span role="alert" className="cad-proposal-error">
            {error}
          </span>
        )}
      </div>
      {overlayHost &&
        createPortal(
          <>
            <dialog
              ref={insert}
              className="cad-cupboard-insert"
              aria-labelledby="cad-cupboard-title"
              onKeyDown={event => event.stopPropagation()}>
              <h2 id="cad-cupboard-title">Insert cupboard</h2>
              <form
                onSubmit={event => {
                  event.preventDefault();
                  void build();
                }}>
                {(['width', 'height', 'depth', 'board', 'shelves'] as const).map(key => (
                  <label key={key}>
                    {key[0].toUpperCase() + key.slice(1)}
                    {key !== 'shelves' && ' (mm)'}
                    <input
                      type="number"
                      required
                      min={key === 'shelves' ? 1 : 1}
                      max={key === 'shelves' ? 30 : 5000}
                      step={key === 'shelves' ? 1 : 'any'}
                      value={sizes[key]}
                      onChange={event => setSizes(previous => ({ ...previous, [key]: Number(event.target.value) }))}
                    />
                  </label>
                ))}
                {error && <p role="alert">{error}</p>}
                <button type="button" disabled={building} onClick={() => insert.current?.close()}>
                  Cancel
                </button>
                <button type="submit" disabled={building}>
                  {building ? 'Checking…' : 'Preview cupboard'}
                </button>
              </form>
            </dialog>
            {assistant && (
              <Suspense fallback={<p>Opening assistant…</p>}>
                <AssistantDock
                  key={document.id}
                  document={document}
                  disabled={disabled}
                  selection={assistantSelection(document, selection)}
                  onProposal={value => {
                    assistantProposal.current = value;
                    setProposal(value);
                  }}
                  onClose={() => setAssistant(false)}
                />
              </Suspense>
            )}
            {proposal && (
              <ProposalReview
                proposal={proposal}
                session={session}
                currentDocument={document}
                disabled={disabled}
                onApply={value => {
                  onApply(value);
                  if (assistantProposal.current === proposal) {
                    appliedProposal.current = proposal;
                    recordAssistantEvent(
                      document.id,
                      'The user applied the checked proposal as one undo step. The next open-design context is authoritative.',
                      'applied'
                    );
                  }
                }}
                onClose={() => {
                  if (assistantProposal.current === proposal && appliedProposal.current !== proposal)
                    recordAssistantEvent(document.id, 'The user discarded the proposal review. No candidate was applied.', 'discarded');
                  assistantProposal.current = null;
                  setProposal(null);
                }}
              />
            )}
          </>,
          overlayHost
        )}
    </>
  );
}
