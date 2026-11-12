import type { CadDocument } from '@wbcnc/cad';
import { cadProposal, type CadProposal } from '@wbcnc/cad-editor/proposal';
import type { AssistantProposalOrigin } from './loop';
import { buildAssistantRecipe, type AssistantRecipeParameters } from './recipeCatalog';
import { checkAssistantRequirements } from './requirements';
import { bindProposalRequirements, readRequirements } from './requirementStore';
import { checkScriptInBrowser } from './scriptCheck';
import { finalizeBrowserCandidate } from './finalizeCandidate';

const origins = new WeakMap<CadProposal, AssistantProposalOrigin>();

export function bindProposalOrigin(proposal: CadProposal, origin: AssistantProposalOrigin | undefined) {
  if (origin) origins.set(proposal, origin);
}
export const proposalOrigin = (proposal: CadProposal) => origins.get(proposal);

/** The recipe values a person can change in review: numbers only, never the folder name or placement. */
export function tweakableParameters(origin: AssistantProposalOrigin | undefined): [string, number][] {
  if (!origin?.recipe) return [];
  return Object.entries(origin.recipe.parameters).filter((entry): entry is [string, number] => typeof entry[1] === 'number');
}

/**
 * The same trusted path a model's candidate takes, without the model: run the script in the sandbox on `base`, run the
 * complete final check, and check the confirmed brief. Only a candidate that passes all three becomes a proposal.
 */
export async function recheckAssistantCandidate(
  base: CadDocument,
  origin: AssistantProposalOrigin,
  signal: AbortSignal,
  parameters?: AssistantRecipeParameters
): Promise<CadProposal> {
  const recipe = parameters && origin.recipe ? buildAssistantRecipe(origin.recipe.name, parameters) : undefined;
  const source = recipe?.source ?? origin.source;
  const brief = readRequirements(base.id);
  const checked = await checkScriptInBrowser(structuredClone(base), source, { signal, toolpaths: false });
  if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
  if (!checked.ok) throw new Error(checked.scriptError ?? checked.report.errors[0]?.message ?? 'The design no longer checks.');
  const full = await finalizeBrowserCandidate(checked, signal);
  if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
  if (!full.ok) throw new Error(full.scriptError ?? full.report.errors[0]?.message ?? 'The complete check failed.');
  if (Object.keys(brief.requirements).length) {
    const acceptance = checkAssistantRequirements(brief.requirements, base, full.document, full.report, full.parts ?? []);
    const failed = acceptance.checks.find(check => !check.passed);
    if (!acceptance.ok) throw new Error(failed?.message ?? `The brief's ${failed?.requirement ?? 'requirements'} no longer hold.`);
  }
  const proposal = cadProposal(base, full.document);
  bindProposalRequirements(proposal, brief.revision);
  bindProposalOrigin(proposal, recipe ? { source, recipe: { name: recipe.recipe, parameters: recipe.parameters } } : { ...origin, source });
  return proposal;
}
