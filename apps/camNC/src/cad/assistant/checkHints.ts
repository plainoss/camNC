import type { AssistantRequirementCheck } from './requirements';

type Issue = { code?: unknown; message?: unknown; part?: unknown };
const issues = (value: unknown): Issue[] => (Array.isArray(value) ? (value as Issue[]) : []);
const part = (issue: Issue) => String(issue.part ?? 'A part');

/** Repairs for the report errors models hit most; any other code falls back to its own message. */
const hints: Record<string, (issue: Issue) => string> = {
  'parts-collide': issue =>
    `${String(issue.message ?? 'Two parts overlap.')} If one board should sit in the other, keep the overlap and join them with d.cutParts(receivingPart, { with: [boardThatSitsInIt] }) so the overlap becomes the housing; otherwise move or resize one so they only touch.`,
  'cut-too-deep': issue =>
    `${part(issue)}: a pocket is as deep as the board. Make it shallower than the thickness or use depth 'through'. For a joint, overlap the boards and use d.cutParts rather than a hand-drawn pocket.`,
  'cut-through-edge': issue =>
    `${part(issue)}: a through cut reaches the edge. Change that part's profile for an open notch, or overlap the boards and use d.cutParts for a joint.`,
  'expect-failed': issue =>
    `${part(issue)}: ${String(issue.message ?? 'an expectation failed')}. Fix the geometry to match the request; change the expectation only if the request did.`,
  'ambiguous-profile': issue =>
    `${part(issue)}: cut shapes in one sketch touch or branch. Keep each cut a separate closed shape that touches nothing else.`,
  'intersecting-profiles': issue => `${part(issue)}: cut shapes cross or touch. Space them apart, or merge them into one closed outline.`,
  'disconnected-profile': issue => `${part(issue)}: its outline has separate pieces. Make each piece its own part.`,
};

const notYet = 'Do not reply with Proposal: until a check passes.';

/**
 * One short next step for a check result. Without it, models often answered "Proposal:" after a failed check;
 * with it, live runs repaired or asked instead.
 */
export function checkNextStep(checked: {
  ok: boolean;
  report?: unknown;
  scriptError?: string;
  /** 'geometry-only' passes still need finalize_design before a proposal. */
  stage?: 'geometry-only' | 'complete';
  requirements?: readonly AssistantRequirementCheck[];
}): string {
  if (checked.scriptError)
    return `The script stopped, so nothing was built and the design is unchanged. Fix that line (check the call against the guide; do not invent methods or options) and check the script again. ${notYet}`;
  const report = (checked.report ?? {}) as { errors?: unknown; warnings?: unknown };
  const unmet = (checked.requirements ?? []).filter(check => !check.passed);
  if (checked.ok) {
    const warnings = [...new Set(issues(report.warnings).map(issue => String(issue.code)))];
    const then =
      checked.stage === 'geometry-only'
        ? 'call finalize_design for this candidate before any Proposal:.'
        : 'reply starting with Proposal:' + (warnings.length ? ' and mention the remaining warnings.' : '.');
    return warnings.length
      ? `Check passed with warnings (${warnings.join(', ')}). Fix any that matter for the request; if it then meets the request, ${then}`
      : `Check passed. Compare the reported sizes, parts and joints with the request; if it meets it, ${then} Otherwise fix the unmet requirement and check again.`;
  }
  const steps = [
    ...new Set([
      ...issues(report.errors).map(issue => hints[String(issue.code)]?.(issue) ?? `${String(issue.code)}: ${String(issue.message ?? '')}`),
      ...unmet.map(
        check =>
          check.message ??
          `Requirement ${check.requirement} is not met (wanted ${JSON.stringify(check.expected)}, got ${JSON.stringify(check.actual)}); the user confirmed it, so change the design, not the requirement.`
      ),
    ]),
  ];
  return `Not a valid candidate yet. ${notYet} Next: ${steps.slice(0, 4).join(' ')}${steps.length > 4 ? ` (+${steps.length - 4} more)` : ''}`;
}
