import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkStudio, studioContent, studioState } from './adapters/studioModel.mjs';

const cupboard = JSON.parse(readFileSync(new URL('../../../../packages/cad-script/fixtures/designs/cupboard.json', import.meta.url)));
describe('Part Studio workflow expectations', () => {
  it('checks every named panel and a shared source variable in a complete cabinet', () => {
    expect(checkStudio({ sourceParts: ['Side', 'Bottom', 'Top', 'Back', 'Shelf'], thicknesses: { Side: 18, Back: 6 }, variables: { board: '18mm' }, copies: { Side: 1 }, partCuts: 1 }, studioState(cupboard))).toEqual([]);
    expect(checkStudio({ thicknesses: { Back: 18 } }, studioState(cupboard))).toEqual(['studio/thicknesses/Back: wanted 18, got 6']);
  });
  it('detects lost identities across a reload and a changed cancelled edit', () => {
    const initial = { ...studioState(cupboard), content: studioContent(cupboard) }, snapshots = new Map([['initial', initial]]);
    const changed = structuredClone(cupboard); changed.parts[0].id = 'replacement'; changed.parts[0].thickness = 24;
    expect(checkStudio({ sameIdsSince: 'initial', unchangedSince: 'initial' }, { ...studioState(changed), content: studioContent(changed) }, snapshots)).toHaveLength(2);
  });
  it('allows revision bookkeeping but refuses unknown checks and missing checkpoints', () => {
    expect(studioContent({ ...cupboard, revision: cupboard.revision + 1 })).toBe(studioContent(cupboard));
    expect(checkStudio({ sameIdsSince: 'missing', ignoredTypo: true }, studioState(cupboard))).toHaveLength(2);
  });
  it('checks the rendered parts list separately from the saved source fields', () => {
    const actual = { ...studioState(cupboard), listedParts: [{ name: 'Side', thickness: 18 }], partIssues: ['Missing face'] };
    expect(checkStudio({ listedParts: [{ name: 'Side', thickness: 24 }], partIssues: [] }, actual)).toHaveLength(2);
  });
});
