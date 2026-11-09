import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { checkChecklist, checkFloors, gatesInFile, main, performanceGates, specCounts } from './status.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

const scenarios = [
  { id: 'sketch/draw/a', domain: 'sketch' },
  { id: 'sketch/draw/b', domain: 'sketch', known: 'still wrong' },
  { id: 'sketch/view/c', domain: 'sketch', flaky: '#1' },
  { id: 'part/extrude/d', domain: 'part' },
];

test('specs are counted per domain and group from their markers: a quarantined spec still counts as passing', () => {
  const counts = specCounts(scenarios);
  assert.deepEqual(
    { ...counts.sketch, groups: undefined },
    { total: 3, pass: 2, xfail: 1, flaky: 1, groups: undefined }
  );
  assert.deepEqual(counts.sketch.groups['sketch/draw'], { total: 2, pass: 1, xfail: 1, flaky: 0 });
  assert.equal(counts.part.pass, 1);
});

test('a passing count below its floor fails, and nothing lowers the floor', () => {
  const counts = specCounts(scenarios);
  const { errors, floors } = checkFloors(counts, { sketch: 3, part: 1 });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /sketch has 2 passing specs, below its floor of 3/);
  assert.deepEqual(floors, { part: 1, sketch: 3 });
  const gone = checkFloors({}, { removed: 4 });
  assert.match(gone.errors[0], /removed has 0 passing specs, below its floor of 4/);
});

test('a count above its floor, or a domain with none, asks for the floor to be raised, and --write raises it', () => {
  const { errors, floors } = checkFloors(specCounts(scenarios), { sketch: 1 });
  assert.equal(errors.length, 2);
  assert.match(errors.find(error => error.startsWith('sketch')), /above its floor of 1: raise the floor\. Run `pnpm run status`/);
  assert.match(errors.find(error => error.startsWith('part')), /no floor/);
  assert.deepEqual(floors, { part: 1, sketch: 2 });
  assert.deepEqual(checkFloors(specCounts(scenarios), { sketch: 2, part: 1 }).errors, []);
});

test('checklist evidence must be a spec ID or an existing file', () => {
  const checklist = {
    statuses: { done: '', partial: '', gap: '' },
    areas: [
      {
        name: 'Sketch tools',
        rows: [
          { item: 'Lines', status: 'done', evidence: ['sketch/draw/a', 'packages/x.test.ts'] },
          { item: 'Arcs', status: 'done', evidence: ['sketch/draw/missing'] },
          { item: 'Slots', status: 'done', evidence: [] },
          { item: 'Gap', status: 'gap', evidence: [] },
          { item: 'Noted gap', status: 'gap', evidence: [], note: 'later' },
          { item: 'Odd', status: 'maybe', evidence: ['../outside'] },
        ],
      },
    ],
  };
  const errors = checkChecklist(checklist, { specIds: new Set(['sketch/draw/a']), fileExists: path => path === 'packages/x.test.ts' || path === '../outside' });
  assert.equal(errors.length, 5, errors.join('\n'));
  assert.match(errors[0], /Arcs: evidence sketch\/draw\/missing is neither a spec ID/);
  assert.match(errors[1], /Slots needs evidence/);
  assert.match(errors[2], /Gap is a gap with no evidence, so it needs a note/);
  assert.match(errors[3], /Odd has status maybe/);
  assert.match(errors[4], /evidence \.\.\/outside is neither/);
});

test('a performance budget is read from the test, a helper it calls, or a named constant', () => {
  const text = `
const kRatio = 6;
function timedWell(work) {
  expect(ratio).toBeLessThan(kRatio);
}
it('[performance] is quick', () => {
  expect((performance.now() - t) / 11).toBeLessThan(120);
});
it.each([1, 2])('[performance] scales to %i', n => {
  timedWell(() => n);
});
it('is not a gate', () => {
  expect(1).toBeLessThan(2);
});
`;
  assert.deepEqual(gatesInFile(text, /\[performance\]/), [
    { title: 'is quick', cases: null, budget: '< 120 ms' },
    { title: 'scales to %i', cases: '[1, 2]', budget: '< 6 × reference work' },
  ]);
  assert.throws(() => gatesInFile(`it('[performance] x', () => { expect(a).toBe(1); });`, /\[performance\]/), /No expect/);
});

test('the gates are the ones the Performance gates step runs, each with a budget', () => {
  const gates = performanceGates(root);
  assert(gates.length >= 4);
  assert.deepEqual([...new Set(gates.map(gate => gate.package))], ['@wbcnc/cam', '@wbcnc/camNC']);
  for (const gate of gates) assert.match(gate.budget, /^< [\d.]+ (ms|× reference work)$/);
});

test('the committed docs/STATUS.md is current, and CI checks it next to the file sizes', async () => {
  assert.equal(await main([], { root }), 0, 'Run `pnpm run status` and commit the result.');
  const steps = parse(readFileSync(`${root}.github/workflows/ci.yml`, 'utf8')).jobs.checks.steps.map(step => step.name);
  assert.equal(steps.indexOf('Check status scorecard'), steps.indexOf('Check file sizes') + 1);
});
