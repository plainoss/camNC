import { createCadDocument, createPlateDocument } from '@wbcnc/cad';
import { afterEach, expect, it } from 'vitest';
import { buildAssistantRecipe } from './recipeCatalog';
import { proposalOrigin, recheckAssistantCandidate, tweakableParameters } from './recheck';
import { confirmRequirements, requirementProposalRefusal } from './requirementStore';

const ids: string[] = [];
afterEach(() => {
  for (const id of ids.splice(0)) confirmRequirements(id, {});
});

it('re-runs a checked script on a changed design without the model, keeping existing IDs', async () => {
  const base = createPlateDocument();
  const edited = { ...base, parts: base.parts.map(part => ({ ...part, name: 'Renamed plate' })) };
  const proposal = await recheckAssistantCandidate(
    edited,
    { source: 'd => { d.part("Renamed plate").thickness(24); }' },
    new AbortController().signal
  );
  expect(proposal.base).toEqual(edited);
  expect(proposal.document.parts[0]).toMatchObject({ id: base.parts[0]!.id, thickness: 24 });
  expect(proposalOrigin(proposal)?.source).toContain('thickness(24)');
}, 60_000);

it('rebuilds a recipe with new values, checks the brief, and binds the brief revision to the new proposal', async () => {
  const base = createCadDocument();
  ids.push(base.id);
  const recipe = buildAssistantRecipe('pebble-tray', { width: 280, height: 190 });
  const origin = { source: recipe.source, recipe: { name: recipe.recipe, parameters: recipe.parameters } };
  expect(tweakableParameters(origin).map(([name]) => name)).toEqual(['width', 'height', 'blank', 'pocketDepth', 'wall']);
  confirmRequirements(base.id, { width: 300 });
  const wider = await recheckAssistantCandidate(base, origin, new AbortController().signal, { ...recipe.parameters, width: 300 });
  expect(requirementProposalRefusal(wider)).toBeUndefined();
  expect(proposalOrigin(wider)?.recipe?.parameters.width).toBe(300);
  await expect(
    recheckAssistantCandidate(base, origin, new AbortController().signal, { ...recipe.parameters, width: 260 })
  ).rejects.toThrow();
  confirmRequirements(base.id, { width: 310 });
  expect(requirementProposalRefusal(wider)).toMatch(/requirements changed/);
}, 90_000);
