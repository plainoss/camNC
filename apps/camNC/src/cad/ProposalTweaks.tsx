import { useEffect, useRef, useState } from 'react';
import type { CadDocument } from '@wbcnc/cad';
import type { CadProposal } from '@wbcnc/cad-editor/proposal';
import { proposalOrigin, recheckAssistantCandidate, tweakableParameters } from './assistant/recheck';

const kRecheckDelayMs = 400;
const names: Record<string, string> = {
  width: 'Width',
  height: 'Height',
  depth: 'Depth',
  board: 'Board',
  blank: 'Blank',
  pocketDepth: 'Pocket depth',
  wall: 'Wall',
  shelves: 'Shelves',
};

/**
 * Changes made in review, without the model: recipe values as sliders, and a re-check of the same script on a design
 * that changed since. Each runs the full trusted check before it replaces the proposal.
 */
export function ProposalTweaks({
  proposal,
  currentDocument,
  stale,
  onReplace,
}: {
  proposal: CadProposal;
  currentDocument: CadDocument;
  stale: boolean;
  onReplace: (proposal: CadProposal) => void;
}) {
  const origin = proposalOrigin(proposal);
  const tweakable = tweakableParameters(origin);
  const [values, setValues] = useState<Record<string, number>>(() => Object.fromEntries(tweakable));
  // The starting values are the slider ranges' middle, so they stay put while the proposal is replaced.
  const [initial] = useState(() => Object.fromEntries(tweakable));
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      controller.current?.abort();
      clearTimeout(timer.current);
    },
    []
  );
  if (!origin) return null;
  const run = (base: CadDocument, parameters?: Record<string, number>) => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setChecking(true);
    setMessage('');
    void recheckAssistantCandidate(base, origin, abort.signal, parameters && { ...origin.recipe!.parameters, ...parameters })
      .then(next => {
        if (abort.signal.aborted) return;
        setMessage('✓ Checked again · no model request');
        onReplace(next);
      })
      .catch(cause => {
        if (!abort.signal.aborted) setMessage(cause instanceof Error ? cause.message : 'The check failed.');
      })
      .finally(() => {
        if (controller.current === abort) setChecking(false);
      });
  };
  if (!tweakable.length && !stale) return null;
  return (
    <section className="cad-proposal-tweaks" aria-label="Adjust before applying">
      <h3>Adjust before applying</h3>
      {stale && (
        <button
          type="button"
          disabled={checking}
          onClick={() => run(structuredClone(currentDocument), tweakable.length ? values : undefined)}>
          Re-check on current design
        </button>
      )}
      {tweakable.map(([name]) => {
        const start = initial[name]!;
        const count = name === 'shelves';
        const min = count ? 1 : Math.max(1, Math.round(start * 0.5)),
          max = count ? Math.max(10, start * 2) : Math.round(start * 1.5);
        return (
          <label key={name}>
            <span>
              {names[name] ?? name}
              <b>
                {values[name]}
                {count ? '' : ' mm'}
              </b>
            </span>
            <input
              type="range"
              min={min}
              max={max}
              step={1}
              value={values[name]}
              disabled={stale}
              onChange={event => {
                const next = { ...values, [name]: Number(event.target.value) };
                setValues(next);
                clearTimeout(timer.current);
                timer.current = setTimeout(() => run(proposal.base, next), kRecheckDelayMs);
              }}
            />
          </label>
        );
      })}
      <p role="status">{checking ? 'Checking locally…' : message}</p>
    </section>
  );
}
