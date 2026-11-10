import type { CadDocument } from '@wbcnc/cad';
import { assessCadTask } from './assess';
import type { CadSavedTask, CadTaskAction, CadTaskCandidate, CadTaskModel, CadTaskRun } from './types';

export interface CadTaskRunOptions {
  maxChecks?: number;
  signal?: AbortSignal;
  /** Execute through the same edit/check implementation used by the assistant. */
  check(script: string, start: CadDocument | null, signal?: AbortSignal): Promise<CadTaskCandidate>;
}

/** A model-neutral, headless repair loop; it never changes or applies to the caller's design. */
export async function runCadTask(
  task: CadSavedTask,
  start: CadDocument | null,
  model: CadTaskModel,
  options: CadTaskRunOptions
): Promise<CadTaskRun> {
  const maxChecks = options.maxChecks ?? 8;
  if (!Number.isSafeInteger(maxChecks) || maxChecks < 1 || maxChecks > 100) throw new Error('maxChecks must be an integer from 1 to 100.');
  const started = performance.now();
  const source = structuredClone(start);
  const result: CadTaskRun = { task: task.id, model: model.id, status: 'error', checks: 0, feedback: [], milliseconds: 0 };
  const finish = (status: CadTaskRun['status'], message?: string): CadTaskRun => ({
    ...result,
    status,
    ...(message && { message }),
    milliseconds: performance.now() - started,
  });
  let candidate: CadTaskCandidate | undefined;
  // A check is the only action that continues, so maxChecks + 1 also bounds provider calls.
  for (let turn = 0; turn <= maxChecks; turn++) {
    if (options.signal?.aborted) return finish('cancelled');
    let action: CadTaskAction;
    try {
      action = await model.next({
        task: structuredClone(task),
        start: structuredClone(source),
        feedback: structuredClone(result.feedback),
        checksRemaining: maxChecks - result.checks,
        signal: options.signal,
      });
    } catch (error) {
      return finish(options.signal?.aborted ? 'cancelled' : 'error', error instanceof Error ? error.message : String(error));
    }
    if (options.signal?.aborted) return finish('cancelled');
    if (!action || typeof action !== 'object') return finish('error', 'The model returned an invalid action.');
    if (action.kind === 'question') return finish('question', action.message);
    if (action.kind === 'propose') {
      if (!candidate?.ok) return finish('failed', 'The model offered no successfully checked candidate.');
      result.assessment = assessCadTask(task, source, candidate, action.message);
      return finish(
        !result.assessment.automaticPass ? 'failed' : result.assessment.review.length ? 'needs-review' : 'passed',
        action.message
      );
    }
    if (action.kind !== 'check' || typeof action.script !== 'string' || !action.script.trim())
      return finish('error', 'The model returned an invalid action.');
    if (result.checks >= maxChecks) return finish('exhausted', `Stopped after ${maxChecks} checks.`);
    result.checks++;
    try {
      // A broken attempt cannot become the base of its repair, nor mutate the saved input.
      candidate = await options.check(action.script, structuredClone(source), options.signal);
      if (options.signal?.aborted) return finish('cancelled');
      result.feedback.push({
        kind: 'checked',
        attempt: result.checks,
        report: candidate.report,
        ...(candidate.scriptError && { scriptError: candidate.scriptError }),
        assessment: assessCadTask(task, source, candidate),
      });
    } catch (error) {
      candidate = undefined;
      if (options.signal?.aborted) return finish('cancelled');
      result.feedback.push({ kind: 'error', attempt: result.checks, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return finish('exhausted', `Stopped after ${maxChecks} checks.`);
}

/** Group repeated tasks by model, while keeping human review separate from a verified pass. */
export function compareCadTaskRuns(runs: readonly CadTaskRun[]) {
  return [...new Set(runs.map(run => run.model))].sort().map(model => {
    const selected = runs.filter(run => run.model === model);
    const counts = Object.fromEntries(
      ['passed', 'failed', 'needs-review', 'question', 'exhausted', 'error', 'cancelled'].map(status => [
        status,
        selected.filter(run => run.status === status).length,
      ])
    );
    return {
      model,
      runs: selected.length,
      outcomes: counts,
      checks: selected.reduce((sum, run) => sum + run.checks, 0),
      milliseconds: selected.reduce((sum, run) => sum + run.milliseconds, 0),
    };
  });
}
