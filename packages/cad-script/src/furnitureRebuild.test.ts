import { setImmediate } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { parseCadDocument, setCadVariable, type CadDocument } from '@wbcnc/cad';
import { editCad, type CadEditResult } from './edit';
import type { CadScript } from './editTypes';
import { frameStool } from './frameStool';
import { addedUnplannedFurniturePieces, furniturePieces, unplannedFurniturePieces } from './furnitureCoverage';
import { inspectCadDocument } from './inspect';
import { panelChair } from './panelChair';
import { assessCadTask } from './tasks/assess';
import { cadSavedTask } from './tasks/catalogue';
import { loadCadTaskStart } from './tasks/files';

// #585's two supplied designs as repair tasks. The assessment measures the rebuilt geometry and its construction plan:
// the originals, and the originals dressed in a borrowed plan, must both fail it.
const failed = (result: CadEditResult, id: string) =>
  assessCadTask(cadSavedTask(id), null, result)
    .checks.filter(check => !check.passed)
    .map(check => check.description);

/** Clears the original pieces and their cuts, then builds the pattern in their place. */
const rebuild =
  (original: CadDocument, pattern: CadScript): CadScript =>
  d => {
    for (const step of original.partCuts ?? []) d.removeStep(step.id);
    for (const part of original.parts) d.removePart(part.name);
    pattern(d);
  };

/** The original with the rebuilt design's plan pasted on: same recipe, members that don't measure. */
function withBorrowedPlan(original: CadDocument, built: CadDocument): CadDocument {
  const plan = structuredClone(built.constructions![0]!);
  const folder = { id: plan.folderId, name: 'Borrowed', partIds: original.parts.map(part => part.id) };
  // Bind every role to an original piece, and every original piece to a role, so no reference is simply missing.
  const pieces = furniturePieces(original);
  plan.members = [
    ...plan.members.map((member, index) => {
      const { partId, copyId } = pieces[index % pieces.length]!;
      return { role: member.role, partId, ...(copyId && { copyId }) };
    }),
    ...pieces
      .slice(plan.members.length)
      .map(({ partId, copyId }, index) => ({ role: `extra-${index}`, partId, ...(copyId && { copyId }) })),
  ];
  return { ...original, folders: [...(original.folders ?? []), folder], constructions: [plan] };
}

describe.each([
  {
    id: 'rebuild-panel-chair',
    pattern: panelChair({ seatWidth: '404mm', seatHeight: '450mm', height: '900mm' }),
    variable: ['board', '20mm'],
  },
  { id: 'rebuild-frame-stool', pattern: frameStool({ height: '650mm' }), variable: ['footrestZ', '230mm'] },
] as const)('$id', ({ id, pattern, variable }) => {
  it('fails the unchanged original and the original with a borrowed plan', async () => {
    const original = (await loadCadTaskStart(cadSavedTask(id)))!;
    const as = await inspectCadDocument(original);
    const unchanged = { document: original, report: as.report, parts: as.parts, ok: as.report.ok };
    expect(unplannedFurniturePieces(original).length).toBeGreaterThan(0);
    expect(failed(unchanged, id)).toEqual(expect.arrayContaining([expect.stringContaining('construction pattern')]));
    expect(failed(unchanged, id)).toEqual(expect.arrayContaining([expect.stringContaining('no loose or unretained piece')]));

    const built = await editCad(null, pattern);
    const dressed = withBorrowedPlan(original, built.document);
    const checked = await inspectCadDocument(dressed);
    // The plan names every original piece, so nothing is unplanned, but its joints don't measure on the weak geometry.
    expect(unplannedFurniturePieces(dressed)).toEqual([]);
    expect(checked.report.errors.some(error => error.code === 'construction-check')).toBe(true);
    expect(failed({ document: dressed, report: checked.report, parts: checked.parts, ok: checked.report.ok }, id)).toEqual(
      expect.arrayContaining([expect.stringContaining('measured joints, fit and hardware')])
    );
  }, 180_000);

  it('passes a rebuild from the pattern, which survives reload and a parameter edit', async () => {
    const original = (await loadCadTaskStart(cadSavedTask(id)))!;
    const result = await editCad(original, rebuild(original, pattern));
    expect(result.scriptError).toBeUndefined();
    expect(failed(result, id)).toEqual([]);
    expect(addedUnplannedFurniturePieces(original, result.document)).toEqual([]);
    // The rebuild and the check of the edited reload each solve for over half a minute: an event-loop turn between them
    // keeps Vitest's worker RPC inside its 60 s deadline (see testSetup.ts).
    await setImmediate();

    const reloaded = parseCadDocument(JSON.parse(JSON.stringify(result.document)));
    const [name, expression] = variable;
    const found = reloaded.variables!.find(v => v.name === name)!;
    const edited = setCadVariable(reloaded, { id: found.id, name, expression });
    if ('error' in edited) throw new Error(edited.error);
    const checked = await inspectCadDocument(edited.document);
    expect(checked.report.errors).toEqual([]);
    expect(failed({ document: edited.document, report: checked.report, parts: checked.parts, ok: checked.report.ok }, id)).toEqual([]);
  }, 240_000);
});
