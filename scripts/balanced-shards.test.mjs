import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { balancedShards } from './balanced-shards.mjs';

const { weightsMs } = JSON.parse(readFileSync(new URL('../apps/camNC/vitest.duration-weights.json', import.meta.url), 'utf8'));

test('measured browser files and new unmeasured files are assigned once with bounded imbalance', () => {
  const files = [...Object.keys(weightsMs), 'src/new-workflow.test.tsx'];
  const weight = file => weightsMs[file] ?? 5000;
  for (const count of [1, 2, 4]) {
    const bins = balancedShards(files, count, file => file, weight);
    assert.deepEqual(bins.flat().sort(), [...files].sort());
    assert.deepEqual(balancedShards([...files].reverse(), count, file => file, weight), bins);
    const sums = bins.map(bin => bin.reduce((sum, file) => sum + weight(file), 0));
    assert(Math.max(...sums) - Math.min(...sums) <= Math.max(...files.map(weight)));
  }
});

test('invalid estimates cannot drop work and duplicate identities fail instead of hiding coverage', () => {
  assert.deepEqual(balancedShards(['a', 'b', 'c'], 2, x => x, () => NaN).flat().sort(), ['a', 'b', 'c']);
  assert.throws(() => balancedShards(['a', 'a'], 2, x => x, () => 1));
  assert.throws(() => balancedShards(['a'], 0, x => x, () => 1));
});
