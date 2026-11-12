import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserSamples, median, medianWeights, scenarioSamples } from './refresh-duration-weights.mjs';

test('weights are per-key medians across runs, sorted by key', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  const weights = medianWeights([[['b', 10], ['a', 1]], [['b', 30]], [['b', 1000.4], ['a', 3]]]);
  assert.deepEqual(Object.entries(weights), [['a', 2], ['b', 30]]);
});

test('only passing measurements count, so a failed early exit cannot shrink a weight', () => {
  const report = { files: [{ file: 'src/a.test.tsx', state: 'pass', testsMs: 10, collectMs: 5 }, { file: 'src/b.test.tsx', state: 'fail', testsMs: 1, collectMs: 1 }] };
  assert.deepEqual(browserSamples([report]), [['src/a.test.tsx', 15]]);
  const results = [{ id: 'x', result: 'PASS', durationMs: 7 }, { id: 'y', result: 'FAIL', durationMs: 1 }, { id: 'z', result: 'FLAKY', durationMs: 9 }];
  assert.deepEqual(scenarioSamples(results), [['x', 7], ['z', 9]]);
});
