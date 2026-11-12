import { createPlateDocument } from '@wbcnc/cad';
import { editCad } from '@wbcnc/cad-script';
import { cadProposal } from '@wbcnc/cad-editor/proposal';
import { expect, it } from 'vitest';
import { checkAssistantRequirements, validateAssistantRequirements } from './requirements';
import { bindProposalRequirements, confirmRequirements, readRequirements, requirementProposalRefusal } from './requirementStore';

it('checks trusted measured geometry independently of script expectations', async () => {
  const base = createPlateDocument();
  const checked = await editCad(
    base,
    d => {
      const tray = d.newPart('Tray', { thickness: 40 });
      tray.profile.rect({ at: [0, 0], w: 280, h: 190 });
      const pocket = tray.sketchOn('top');
      pocket.rect({ at: [18, 18], w: 244, h: 154 });
      tray.cut(pocket.regionAt(100, 100), { depth: 30 });
      tray.expect({ size: [280, 190] });
    },
    { toolpaths: false }
  );
  expect(checked.ok).toBe(true);
  const requirements = {
    part: 'Tray',
    width: 280,
    height: 190,
    thickness: 40,
    pocketDepth: 30,
    minimumFloor: 10,
    minimumWall: 18,
    holeCount: 0,
    pocketCount: 1,
  };
  expect(checkAssistantRequirements(requirements, base, checked.document, checked.report, checked.parts).ok).toBe(true);
  const wrong = checkAssistantRequirements(
    { ...requirements, width: 300, minimumWall: 20 },
    base,
    checked.document,
    checked.report,
    checked.parts
  );
  expect(wrong.ok).toBe(false);
  expect(wrong.checks.filter(check => !check.passed).map(check => check.requirement)).toEqual(['width', 'minimumWall']);
  expect(checkAssistantRequirements({ width: 280 }, base, checked.document, checked.report, checked.parts).ok).toBe(false);
});

it('refuses removed existing identities and malformed or unsupported requirements', () => {
  const base = createPlateDocument();
  const candidate = structuredClone(base);
  candidate.parts = [];
  const result = checkAssistantRequirements(
    { preserveExistingIds: true },
    base,
    candidate,
    { ok: true, status: 'solved', errors: [], warnings: [], parts: [] },
    []
  );
  expect(result.ok).toBe(false);
  expect(() => validateAssistantRequirements({ width: NaN })).toThrow();
  expect(() => validateAssistantRequirements({ holeCount: 1.5 })).toThrow();
  expect(() => validateAssistantRequirements({ tolerance: 100 } as never)).toThrow(/Unknown/);
});

it('invalidates an already reviewed proposal when confirmed requirements change', () => {
  const base = createPlateDocument();
  const confirmed = confirmRequirements(base.id, { width: 280 });
  const proposal = cadProposal(base, base);
  bindProposalRequirements(proposal, confirmed.revision);
  expect(requirementProposalRefusal(proposal)).toBeUndefined();
  confirmRequirements(base.id, { width: 280 });
  expect(readRequirements(base.id).revision).toBe(confirmed.revision);
  confirmRequirements(base.id, { width: 300 });
  expect(requirementProposalRefusal(proposal)).toMatch(/requirements changed/);
  expect(requirementProposalRefusal(cadProposal(base, base))).toBeUndefined();
});

it('canonicalizes cleared optional fields without retaining an active empty contract', () => {
  const base = createPlateDocument();
  confirmRequirements(base.id, { width: 280 });
  const cleared = confirmRequirements(base.id, { width: undefined, preserveExistingIds: undefined });
  expect(cleared.requirements).toEqual({});
  expect(confirmRequirements(base.id, {}).revision).toBe(cleared.revision);
});
