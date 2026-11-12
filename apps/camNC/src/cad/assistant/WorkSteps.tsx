import { describeStep, turnOutcome, type AssistantWorkStep, type Outcome } from './stepSummary';

const icons: Record<Outcome, string> = { done: '✓', passed: '✓', warned: '⚠', failed: '↻', working: '◌', missing: '–' };

/** The assistant's work for one turn, inline in the conversation: open while it runs, folded to one line after. */
export function WorkSteps({ steps, running, activity }: { steps: AssistantWorkStep[]; running: boolean; activity?: string }) {
  const described = steps.map(step => describeStep(step, running));
  const outcome = turnOutcome(steps, running);
  const checks = steps.filter(step => step.call.name === 'check_design' || step.call.name === 'check_svg').length;
  const images = steps.flatMap(step => step.result?.images ?? []);
  return (
    <details className="cad-assistant-work" open={running || undefined} data-running={running} data-outcome={outcome}>
      <summary>
        <span aria-hidden="true" className="cad-assistant-work-icon">
          {icons[outcome]}
        </span>
        <span>
          {running
            ? activity || 'Working…'
            : `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}${checks ? ` · ${checks} ${checks === 1 ? 'check' : 'checks'}` : ''}`}
        </span>
      </summary>
      <ol aria-label="Assistant steps">
        {described.map((step, index) => (
          <li key={`${steps[index]!.call.id}-${index}`} data-outcome={step.outcome}>
            <span aria-hidden="true">{icons[step.outcome]}</span>
            <span>
              {step.text}
              {step.note && <small>{step.note}</small>}
            </span>
          </li>
        ))}
      </ol>
      {images.length > 0 && <small>{images.length} design views were checked.</small>}
      <details className="cad-assistant-work-details">
        <summary>Details</summary>
        <ol aria-label="Tool activity">
          {steps.map(({ call, result }, index) => (
            <li key={`${call.id}-${index}`}>
              <strong>{call.name}</strong>
              <pre>{JSON.stringify(call.arguments, null, 2)}</pre>
              {result && <pre>{formatResult(result.text)}</pre>}
              {!!result?.images?.length && <small>{result.images.length} design views returned; image data omitted.</small>}
            </li>
          ))}
        </ol>
      </details>
    </details>
  );
}

function formatResult(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
