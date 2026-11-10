import assert from 'node:assert/strict';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkStudio, studioContent, studioState } from './adapters/studioModel.mjs';

const cupboard = JSON.parse(readFileSync(new URL('../../../../packages/cad-script/fixtures/designs/cupboard.json', import.meta.url)));
describe('Part Studio workflow expectations', () => {
  it('checks visible section lifecycle and fields independently of saved geometry', () => {
    const actual = { section: { active: true, editing: true, plane: 'right', offset: '#board-4mm', flipped: false } };
    expect(checkStudio({ section: { active: true, offset: '#board-4mm' } }, actual)).toEqual([]);
    expect(checkStudio({ section: { active: false, offset: '14', flipped: true } }, actual)).toHaveLength(3);
    expect(checkStudio({ section: { active: true } }, {})).toHaveLength(1);
  });
  it('checks visible measurement values independently of saved geometry', () => {
    expect(checkStudio({ measurements: { 'Min distance': '18 mm' } }, { measurements: { 'Min distance': '18 mm' } })).toEqual([]);
    expect(checkStudio({ measurements: { 'Min distance': '18 mm' } }, { measurements: { 'Min distance': '0 mm' } })).toHaveLength(1);
  });
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
it('names the exact persisted copy tool and rejects a sibling despite unchanged body counts', () => {
  const design=structuredClone(cupboard),shelf=design.parts.find(p=>p.name==='Shelf');
  shelf.copies=[{id:'pattern:1'},{id:'pattern:2'}];
  design.partCuts[0].tools=[`${shelf.id}:pattern:2`];
  const state=studioState(design);
  expect(state.cutSettings[0].tools).toEqual(['Shelf 3']);
  const expected={cutSettings:state.cutSettings};
  design.partCuts[0].tools=[`${shelf.id}:pattern:1`];
  expect(checkStudio(expected,studioState(design))).toHaveLength(1);
  expect(checkStudio({dialogSelections:{Tools:['Shelf 3'],Targets:['Side']}},{dialogSelections:{Tools:['Shelf'],Targets:['Side']}})).toHaveLength(1);
});
it('retains feature identities by variable, source sketch, pattern and joint slot', () => {
  const design = JSON.parse(readFileSync(new URL('../../../../packages/cad-script/fixtures/designs/fitted-joints.json', import.meta.url)));
  const snapshots = new Map([['assembled', studioState(design)]]);
  const expected = { sameFeatureIdsSince: 'assembled' };
  expect(checkStudio(expected, studioState(design), snapshots)).toEqual([]);
  const changed = structuredClone(design);
  [changed.partCuts[0].id, changed.partCuts[1].id] = [changed.partCuts[1].id, changed.partCuts[0].id];
  expect(checkStudio(expected, studioState(changed), snapshots)).toHaveLength(1);
  for (const mutate of [d => { d.variables[0].id = 'replacement'; }, d => { d.parts[0].sketch.id = 'replacement'; }]) {
    const replacement = structuredClone(design); mutate(replacement);
    expect(checkStudio(expected, studioState(replacement), snapshots)).toHaveLength(1);
  }
});
it('checks linked clearance and independent split snapshots without changing housing expectations', () => {
  const design = JSON.parse(readFileSync(new URL('../../../../packages/cad-script/fixtures/designs/fitted-joints.json', import.meta.url)));
  const before = studioState(design);
  expect(before.cutSettings.map(cut => cut.split)).toEqual(['half', { fingers: 5, fingersExpression: 'fingers' }]);
  design.partCuts[1].split.fingers = 8;
  design.partCuts[0].clearanceExpression = 'unlinked';
  expect(checkStudio({ cutSettings: before.cutSettings, cutExpressions: ['fit', 'fit'] }, studioState(design))).toHaveLength(2);
  expect(before.cutSettings[1].split.fingers).toBe(5);
  expect(studioState(cupboard).cutSettings[0]).not.toHaveProperty('split');
});
it('distinguishes circular sweep, spacing mode and axis from equal copy counts', () => {
  const design = structuredClone(cupboard), shelf = design.parts.find(part => part.name === 'Shelf');
  shelf.pattern = {
    id: 'radial', axis: 'z', count: 4, spacing: 0,
    circular: { origin: [20, 30, 0], axis: [0, 0, 1], angle: 180, angleExpression: 'sweep' },
  };
  const initial = studioState(design), wanted = { patterns: { Shelf: { circular: initial.patterns.Shelf.circular } } };
  expect(checkStudio(wanted, initial)).toEqual([]);
  for (const change of [
    circular => { circular.equalSpacing = false; },
    circular => { circular.opposite = true; },
    circular => { circular.axis = [1, 0, 0]; },
    circular => { circular.origin[0] = 0; },
    circular => { circular.angleExpression = '180deg'; },
  ]) {
    const altered = structuredClone(design);
    change(altered.parts.find(part => part.name === 'Shelf').pattern.circular);
    expect(checkStudio(wanted, studioState(altered))).toHaveLength(1);
  }
  expect(initial.patterns.Shelf.circular.origin).toEqual([20, 30, 0]);
});

it('preserves a raw exact target while its trailing physical slot is absent', () => {
  const design = structuredClone(cupboard), shelf = design.parts.find(part => part.name === 'Shelf');
  shelf.copies = [{ id: 'pattern:1' }, { id: 'pattern:2' }];
  design.partCuts[0].targets = [`${shelf.id}:pattern:2`];
  const checkpoints = new Map([['selected', studioState(design)]]), expected = { sameCutReferencesSince: 'selected' };
  shelf.copies.pop();
  expect(studioState(design).cutSettings[0].targets).toEqual([null]);
  expect(checkStudio(expected, studioState(design), checkpoints)).toEqual([]);
  for (const reference of [shelf.id, `${shelf.id}:pattern:1`]) {
    const changed = structuredClone(design); changed.partCuts[0].targets = [reference];
    expect(checkStudio(expected, studioState(changed), checkpoints)).toHaveLength(1);
  }
});

it('allows only trailing-slot removal while preserving named source and sibling identities', () => {
  const design = structuredClone(cupboard), shelf = design.parts.find(part => part.name === 'Shelf');
  shelf.copies = [{ id: 'pattern:1' }, { id: 'pattern:2' }];
  const checkpoints = new Map([['selected', studioState(design)]]);
  const expected = { copyMembershipSince: { checkpoint: 'selected', part: 'Shelf', copies: 1 } };
  shelf.copies.pop();
  expect(checkStudio(expected, studioState(design), checkpoints)).toEqual([]);
  const replacement = structuredClone(design); replacement.parts.find(part => part.name === 'Shelf').copies[0].id = 'pattern:2';
  expect(checkStudio(expected, studioState(replacement), checkpoints)).toHaveLength(1);
  const swapped = structuredClone(design), bottom = swapped.parts.find(part => part.name === 'Bottom'), top = swapped.parts.find(part => part.name === 'Top');
  [bottom.id, top.id] = [top.id, bottom.id];
  expect(checkStudio(expected, studioState(swapped), checkpoints)).toHaveLength(2);
  expect(checkStudio({ copyMembershipSince: { ...expected.copyMembershipSince, copies: 3 } }, studioState(design), checkpoints)).toHaveLength(1);
  expect(checkStudio({ copyMembershipSince: { ...expected.copyMembershipSince, part: 'Missing' } }, studioState(design), checkpoints)).toHaveLength(1);
});
