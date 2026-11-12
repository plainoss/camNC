import type { CadProposal } from '@wbcnc/cad-editor/proposal';

type Issue = { code?: unknown; message?: unknown };

/** Report notices that say nothing about the proposal: the empty first sketch every new studio starts with. */
const kNotAboutTheProposal = new Set(['empty-sketch']);

/** The messages worth showing a person from a check report's warnings, once each. */
export function checkWarningMessages(warnings: unknown): string[] {
  if (!Array.isArray(warnings)) return [];
  const messages = (warnings as Issue[])
    .filter(issue => !kNotAboutTheProposal.has(String(issue?.code)))
    .map(issue => (typeof issue?.message === 'string' ? issue.message : String(issue?.code ?? '')))
    .filter(Boolean);
  return [...new Set(messages)];
}

const warnings = new WeakMap<CadProposal, string[]>();

/** The final check's warnings, such as a cut no tool can machine, kept with the proposal so the review shows them. */
export function bindProposalWarnings(proposal: CadProposal, report: unknown) {
  const messages = checkWarningMessages((report as { warnings?: unknown } | undefined)?.warnings);
  if (messages.length) warnings.set(proposal, messages);
}
export const proposalCheckWarnings = (proposal: CadProposal) => warnings.get(proposal) ?? [];
