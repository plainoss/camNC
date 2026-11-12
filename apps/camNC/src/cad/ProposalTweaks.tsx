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
  onBusy,
}: {
  proposal: CadProposal;
  currentDocument: CadDocument;
  stale: boolean;
  /** False when the host dropped the result, e.g. because a newer proposal arrived meanwhile. */
  onReplace: (proposal: CadProposal) => boolean | void;
  /** True from a slider move until its re-check ends: Apply must not take the old design while the slider shows another. */
  onBusy?: (busy: boolean) => void;
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
      onBusy?.(false);
    },
    // onBusy is the review's state setter; it never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  if (!origin) return null;
  const run = (base: CadDocument, parameters?: Record<string, number>) => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setChecking(true);
    onBusy?.(true);
    setMessage('');
    void recheckAssistantCandidate(base, origin, abort.signal, parameters && { ...origin.recipe!.parameters, ...parameters })
      .then(next => {
        if (abort.signal.aborted) return;
        if (onReplace(next) === false) {
          setMessage('A newer proposal arrived, so this change was not used.');
          setValues(Object.fromEntries(tweakable));
        } else setMessage('✓ Checked again · no model request');
      })
      .catch(cause => {
        if (abort.signal.aborted) return;
        setMessage(cause instanceof Error ? cause.message : 'The check failed.');
        // The proposal is unchanged, so the sliders go back to what it was built with.
        setValues(Object.fromEntries(tweakable));
      })
      .finally(() => {
        if (controller.current !== abort) return;
        setChecking(false);
        onBusy?.(false);
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
                // A re-check still running is for an older value: stop it now, so its end neither clears busy nor
                // moves the slider back while the next one waits for its delay.
                controller.current?.abort();
                controller.current = null;
                onBusy?.(true);
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
