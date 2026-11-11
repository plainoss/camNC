import { createCadDocument, type CadDocument } from '@wbcnc/cad';
import { compactCadReport, inspectCadDocument } from '@wbcnc/cad-script';
import { assessCadTask } from '../../../../../packages/cad-script/src/tasks/assess';
import type { CadSavedTask, CadTaskAssessment, CadTaskCandidate } from '../../../../../packages/cad-script/src/tasks/types';
import { assistantGuide, guideSections } from './guide';
import { runDesignAssistant, type AssistantRunOptions } from './loop';
import { summarizeAssistantReport } from './report';

export interface AssistantTaskBenchmark {
  task: string;
  kind: 'production-loop';
  result: Awaited<ReturnType<typeof runDesignAssistant>>;
  assessment?: CadTaskAssessment;
  milliseconds: number;
}

/** Fresh providers and recorded adapters exercise the dock's actual loop and independent saved outcomes. */
export async function benchmarkAssistantTask(
  task: CadSavedTask,
  start: CadDocument | null,
  options: Omit<AssistantRunOptions, 'base' | 'messages' | 'context' | 'guide' | 'guideSections' | 'report' | 'check'> & {
    check(
      source: string,
      base: CadDocument,
      signal: AbortSignal,
      options?: { views: boolean }
    ): Promise<CadTaskCandidate & { images?: import('./provider').AssistantImage[] }>;
    attachments?: import('./provider').AssistantImage[];
    /** Opt in only when check independently inspects the returned document in a trusted runtime and returns its matching report and parts. Defaults to false for arbitrary adapters. */
    reuseTrustedCheckResults?: boolean;
  }
): Promise<AssistantTaskBenchmark> {
  const { reuseTrustedCheckResults = false, ...runOptions } = options;
  const started = performance.now();
  const base = start ?? { ...createCadDocument(task.id), parts: [] };
  const initial = await inspectCadDocument(base);
  const checkedCandidates = new Map<string, CadTaskCandidate>();
  const result = await runDesignAssistant({
    ...runOptions,
    base,
    messages: [
      ...(task.history ?? []).map(message => ({ role: message.role, text: message.content })),
      { role: 'user', text: task.request, ...(options.attachments?.length && { images: options.attachments }) },
    ],
    guide: assistantGuide,
    guideSections,
    report: compactCadReport(initial.document, initial.report),
    context: JSON.stringify({ design: summarizeAssistantReport(compactCadReport(initial.document, initial.report)) }),
    check: async (source, document, signal, viewOptions) => {
      const checked = await options.check(source, document, signal, viewOptions);
      // Retain independent trusted snapshots: later adapter mutations or failed checks must not replace a valid candidate.
      if (reuseTrustedCheckResults && checked.ok && checked.report.ok && !checked.scriptError)
        checkedCandidates.set(
          JSON.stringify(checked.document),
          structuredClone({
            document: checked.document,
            report: checked.report,
            parts: checked.parts,
            ok: checked.ok,
          })
        );
      const detailReport = compactCadReport(checked.document, checked.report);
      return { ...checked, detailReport, report: summarizeAssistantReport(detailReport) };
    },
  });
  const response = result.messages.at(-1)?.text ?? '';
  // A repeated script can reuse an earlier check. Assess the actual offered document, never the last executed attempt.
  const candidate = result.proposal
    ? (checkedCandidates.get(JSON.stringify(result.proposal.document)) ?? (await inspectCadDocument(result.proposal.document)))
    : undefined;
  const assessment = candidate ? assessCadTask(task, start, { ...candidate, ok: candidate.report.ok }, response) : undefined;
  return { task: task.id, kind: 'production-loop', result, ...(assessment && { assessment }), milliseconds: performance.now() - started };
}
