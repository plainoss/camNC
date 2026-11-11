import type { AssistantMessage, AssistantToolCall } from './provider';

export interface AssistantWorkStep {
  call: AssistantToolCall;
  result?: AssistantMessage;
}
export type Outcome = 'done' | 'passed' | 'failed' | 'working' | 'missing';

function parse(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
const short = (text: string, length = 90) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);
const named = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

/** Why a check failed, in the words of its first failed requirement, script error or report error. */
function failure(result: Record<string, unknown>): string | undefined {
  const requirements = result.requirements as {
    checks?: { requirement?: string; passed?: boolean; message?: string; expected?: unknown; actual?: unknown }[];
  };
  const failed = requirements?.checks?.find(check => check.passed === false);
  if (failed)
    return (
      failed.message ??
      `${failed.requirement}: ${JSON.stringify(failed.actual)}${failed.expected !== undefined ? `, needs ${JSON.stringify(failed.expected)}` : ''}`
    );
  if (named(result.scriptError)) return named(result.scriptError);
  const report = result.report as { errors?: unknown[] } | undefined;
  const error = report?.errors?.[0];
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) return named((error as { message: unknown }).message);
}

/** One plain sentence per tool call; the raw inputs and results stay behind Details. */
export function describeStep({ call, result }: AssistantWorkStep, running: boolean): { text: string; outcome: Outcome; note?: string } {
  const args = call.arguments;
  const parsed = result ? parse(result.text) : null;
  const pending: Outcome = result ? 'done' : running ? 'working' : 'missing';
  switch (call.name) {
    case 'cad_script_guide':
      return { text: named(args.section) ? `Read the guide on ${args.section}` : 'Read the script guide', outcome: pending };
    case 'cad_script_example':
      return { text: `Looked at the ${named(args.name) ?? ''} example`.replace('  ', ' '), outcome: pending };
    case 'read_design_report':
      return { text: named(args.section) ? `Read the design report: ${args.section}` : 'Read the design report', outcome: pending };
    case 'read_design':
      return { text: 'Re-read the last checked script', outcome: pending };
    case 'finalize_design':
    case 'check_design':
    case 'check_svg': {
      const what =
        call.name === 'finalize_design'
          ? 'Ran the complete final check'
          : call.name === 'check_svg'
            ? 'Checked SVG outlines as sketch curves'
            : named(args.recipe)
              ? `Built from the ${args.recipe} recipe`
              : named(args.scriptId)
                ? `Repaired the script${Array.isArray(args.patches) ? ` (${args.patches.length} ${args.patches.length === 1 ? 'edit' : 'edits'})` : ''}`
                : 'Wrote and checked a design script';
      if (!result) return { text: what, outcome: pending };
      if (!parsed) return { text: what, outcome: 'failed', note: short(result.text) };
      if (parsed.ok === true)
        return { text: what, outcome: 'passed', note: call.name === 'finalize_design' ? 'Ready to review' : 'Check passed' };
      return { text: what, outcome: 'failed', note: short(failure(parsed) ?? 'Needs repair') };
    }
    default:
      return { text: call.name.replaceAll('_', ' '), outcome: pending };
  }
}

/** Splits a conversation into messages and the work between them, pairing each tool call with its result. */
export function conversationItems(messages: AssistantMessage[]) {
  const items: ({ kind: 'message'; message: AssistantMessage } | { kind: 'work'; steps: AssistantWorkStep[] })[] = [];
  const byId = new Map<string, AssistantWorkStep>();
  for (const message of messages) {
    if (message.role === 'tool') {
      const step = message.callId ? byId.get(message.callId) : undefined;
      if (step) step.result = message;
      continue;
    }
    if (message.role === 'assistant' && message.text) items.push({ kind: 'message', message });
    const calls = message.role === 'assistant' ? (message.calls ?? []) : [];
    const work = calls.filter(call => call.name !== 'ask_user');
    if (work.length) {
      const last = items.at(-1);
      const group = last?.kind === 'work' ? last : { kind: 'work' as const, steps: [] };
      if (group !== last) items.push(group);
      for (const call of work) {
        const step = { call };
        group.steps.push(step);
        byId.set(call.id, step);
      }
    }
    if (calls.some(call => call.name === 'ask_user') && !message.text) items.push({ kind: 'message', message });
    if (message.role !== 'assistant') items.push({ kind: 'message', message });
  }
  return items;
}
