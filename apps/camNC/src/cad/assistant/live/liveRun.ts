import { createCadDocument, type CadDocument } from '@wbcnc/cad';
import { compactCadReport, inspectCadDocument } from '@wbcnc/cad-script';
import { assessCadTask } from '../../../../../../packages/cad-script/src/tasks/assess';
import type { CadSavedTask, CadTaskAssessment } from '../../../../../../packages/cad-script/src/tasks/types';
import { assistantGuide, guideSections } from '../guide';
import { resumeAssistantMessages, runDesignAssistant, type AssistantRunOptions, type AssistantRunResult } from '../loop';
import type { AssistantMessage } from '../provider';
import { summarizeAssistantReport } from '../report';
import { checkScriptInBrowser } from '../scriptCheck';
import { assessLiveTask } from './liveTasks';

/** A person who accepts the assistant's own suggestion, so single-request benchmarks are not ended by a question. */
export const autoReply = 'Use your recommended choice for that and sensible defaults for anything else. Build it and check it now; no more questions.';

export interface LiveRun {
  results: AssistantRunResult[];
  messages: AssistantMessage[];
  questions: number;
  scriptErrors: number;
  failedChecks: number;
  assessment?: CadTaskAssessment;
}

/**
 * Same wiring as benchmarkAssistantTask (and the dock), plus up to `replies` simulated "use your suggestion" answers.
 * Every turn runs the production loop with the real sandboxed check.
 */
export async function runLiveTask(
  task: CadSavedTask,
  start: CadDocument | null,
  options: Pick<AssistantRunOptions, 'config' | 'key' | 'examples' | 'pricing' | 'limits' | 'request' | 'signal'> & { replies: number }
): Promise<LiveRun> {
  const base = start ?? { ...createCadDocument(task.id), parts: [] };
  const initial = await inspectCadDocument(base);
  const report = compactCadReport(initial.document, initial.report);
  let messages: AssistantMessage[] = [
    ...(task.history ?? []).map(message => ({ role: message.role, text: message.content })),
    { role: 'user', text: task.request },
  ];
  const run: LiveRun = { results: [], messages, questions: 0, scriptErrors: 0, failedChecks: 0 };
  for (let turn = 0; turn <= options.replies; turn++) {
    const result = await runDesignAssistant({
      ...options,
      base,
      messages,
      guide: assistantGuide,
      guideSections,
      report,
      context: JSON.stringify({ design: summarizeAssistantReport(report) }),
      check: async (source, document, signal) => {
        const checked = await checkScriptInBrowser(document, source, { signal });
        if (checked.scriptError) run.scriptErrors++;
        if (!checked.ok) run.failedChecks++;
        const detailReport = compactCadReport(checked.document, checked.report);
        return { ...checked, detailReport, report: summarizeAssistantReport(detailReport) };
      },
    });
    run.results.push(result);
    messages = result.messages;
    if (result.status !== 'question') break;
    run.questions++;
    if (turn < options.replies) messages = [...resumeAssistantMessages(messages), { role: 'user', text: autoReply }];
  }
  run.messages = messages;
  const last = run.results.at(-1)!;
  if (last.proposal) {
    const candidate = await inspectCadDocument(last.proposal.document);
    const response = last.messages.at(-1)?.text ?? '';
    const checked = { ...candidate, ok: candidate.report.ok };
    run.assessment = assessLiveTask(task, checked, assessCadTask(task, start, checked, response));
  }
  return run;
}
