import type { CadProposal } from '@wbcnc/cad-editor/proposal';
import { validateAssistantRequirements, type AssistantRequirements } from './requirements';

interface ConfirmedRequirements {
  revision: number;
  requirements: AssistantRequirements;
}
const requirements = new Map<string, ConfirmedRequirements>();
const listeners = new Map<string, Set<() => void>>();
const proposals = new WeakMap<CadProposal, { documentId: string; revision: number }>();

export function readRequirements(id: string): ConfirmedRequirements {
  const current = requirements.get(id);
  return current ? structuredClone(current) : { revision: 0, requirements: {} };
}
export function confirmRequirements(id: string, input: AssistantRequirements) {
  const current = readRequirements(id);
  const confirmed = validateAssistantRequirements(input);
  if (JSON.stringify(confirmed) === JSON.stringify(current.requirements)) return current;
  const next = { revision: current.revision + 1, requirements: confirmed };
  requirements.set(id, next);
  for (const listener of listeners.get(id) ?? []) listener();
  return structuredClone(next);
}
export function subscribeRequirements(id: string, listener: () => void) {
  const set = listeners.get(id) ?? new Set();
  set.add(listener);
  listeners.set(id, set);
  return () => {
    set.delete(listener);
    if (!set.size) listeners.delete(id);
  };
}
export function bindProposalRequirements(proposal: CadProposal, revision: number) {
  proposals.set(proposal, { documentId: proposal.base.id, revision });
}
export function requirementProposalRefusal(proposal: CadProposal): string | undefined {
  const bound = proposals.get(proposal);
  // Non-assistant imports and native cupboard proposals retain their ordinary document guards.
  if (bound && readRequirements(bound.documentId).revision !== bound.revision)
    return 'Confirmed requirements changed. Check a new proposal before applying.';
}
