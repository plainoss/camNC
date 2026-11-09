import assert from 'node:assert/strict';
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

it('source expectations reject wrong pattern, offset and consumed tools',()=>{
  const state=studioState(cupboard);
  assert.equal(checkStudio({patterns:{Shelf:{count:3}},offsets:{Shelf:{value:231.5}},cutSettings:[{keepTools:false}]},state).length,3);
});
it('retained-identity and exact growth checks reject churn despite unchanged count and dimensions',()=>{
  const before=structuredClone(cupboard),shelf=before.parts.find(p=>p.name==='Shelf');
  shelf.pattern={id:'stable-pattern',axis:'z',count:3,countExpression:'shelves',spacing:120};
  shelf.copies=[{id:'copy-one'},{id:'copy-two'}];
  const checkpoints=new Map([['repeat-shelves',studioState(before)]]);
  const good=structuredClone(before),next=good.parts.find(p=>p.name==='Shelf');
  next.pattern.count=4;next.copies.push({id:'copy-three'});
  const expected={retainedIdsSince:'repeat-shelves',samePatternIdsSince:'repeat-shelves',addedCopyIdsSince:{checkpoint:'repeat-shelves',part:'Shelf',count:1}};
  assert.deepEqual(checkStudio(expected,studioState(good),checkpoints),[]);
  next.copies.reverse();
  assert.equal(checkStudio(expected,studioState(good),checkpoints).length,2);
  next.copies.reverse();
  next.copies[0].id='churned-copy';
  assert.equal(checkStudio(expected,studioState(good),checkpoints).length,3);
  next.pattern.id='churned-pattern';
  assert.equal(checkStudio(expected,studioState(good),checkpoints).length,4);
});
it('retained identities keep their named source owner when panels are swapped', () => {
  const changed = structuredClone(cupboard), bottom = changed.parts.find(part => part.name === 'Bottom'), top = changed.parts.find(part => part.name === 'Top');
  [bottom.id, top.id] = [top.id, bottom.id];
  const failures = checkStudio({ retainedIdsSince: 'assembled' }, studioState(changed), new Map([['assembled', studioState(cupboard)]]));
  expect(failures).toHaveLength(2);
  expect(failures[0]).toContain('/Bottom/0');
  expect(failures[1]).toContain('/Top/0');
});
