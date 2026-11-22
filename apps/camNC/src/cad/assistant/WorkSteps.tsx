import { t as translate } from '@wbcnc/i18n';
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
            ? activity || translate('Working…')
            : translate('{{value1}} {{value2}}{{value3}}', {
                value1: steps.length,
                value2: steps.length === 1 ? translate('step') : translate('steps'),
                value3: checks ? ` · ${checks} ${checks === 1 ? translate('check') : translate('checks')}` : '',
              })}
        </span>
      </summary>
      <ol aria-label={translate('Assistant steps')}>
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
      {images.length > 0 && (
        <small>
          {images.length}
          {translate(' design views were checked.')}
        </small>
      )}
      <details className="cad-assistant-work-details">
        <summary>{translate('Details')}</summary>
        <ol aria-label={translate('Tool activity')}>
          {steps.map(({ call, result }, index) => (
            <li key={`${call.id}-${index}`}>
              <strong>{call.name}</strong>
              <pre>{JSON.stringify(call.arguments, null, 2)}</pre>
              {result && <pre>{formatResult(result.text)}</pre>}
              {!!result?.images?.length && (
                <small>
                  {result.images.length}
                  {translate(' design views returned; image data omitted.')}
                </small>
              )}
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
