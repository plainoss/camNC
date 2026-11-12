import type { CadDocument, EvaluatedCadPart } from '@wbcnc/cad';
import type { CadReport } from '../inspect';

export interface CadSavedTask {
  id: string;
  request: string;
  /** The exact starting design, independent of any candidate produced during this run. */
  start: string | null;
  /** issue-input: a supplied design to repair, kept byte for byte. */
  source: 'chat-trial' | 'whole-piece-requirement' | 'issue-input';
  /** An earlier request can constrain the outcome even when this turn does not repeat it. */
  history?: { role: 'user' | 'assistant'; content: string }[];
  attachments?: { file: string; mediaType: 'image/svg+xml' | 'image/png' | 'image/jpeg'; description: string }[];
  /** Expectations are written from the request, never copied from a candidate's report. */
  outcomes: string[];
  /** These claims require an identified person to judge them; geometry alone cannot pass them. */
  review: string[];
  recording?: { model: string; directory: string };
}

export interface CadTaskCandidate {
  document: CadDocument;
  report: CadReport;
  parts: EvaluatedCadPart[];
  ok: boolean;
  scriptError?: string;
}
export interface CadTaskCheck {
  description: string;
  passed: boolean;
  expected?: unknown;
  actual?: unknown;
}
export interface CadTaskAssessment {
  checks: CadTaskCheck[];
  /** A solver pass is necessary, but never substitutes for an outcome or visual review. */
  automaticPass: boolean;
  review: string[];
}

export type CadTaskAction =
  | { kind: 'check'; script: string }
  | { kind: 'propose'; message: string }
  | { kind: 'question'; message: string };
export type CadTaskFeedback =
  | { kind: 'checked'; attempt: number; report: CadReport; scriptError?: string; assessment: CadTaskAssessment }
  | { kind: 'error'; attempt: number; message: string };
export interface CadTaskModelInput {
  task: CadSavedTask;
  start: CadDocument | null;
  /** Every repair is checked against start, so rejected attempts never accumulate changes. */
  feedback: readonly CadTaskFeedback[];
  checksRemaining: number;
  signal?: AbortSignal;
}
export interface CadTaskModel {
  id: string;
  next(input: CadTaskModelInput): Promise<CadTaskAction>;
}
export interface CadTaskRun {
  task: string;
  model: string;
  status: 'passed' | 'failed' | 'needs-review' | 'question' | 'exhausted' | 'error' | 'cancelled';
  checks: number;
  feedback: CadTaskFeedback[];
  message?: string;
  assessment?: CadTaskAssessment;
  milliseconds: number;
}
