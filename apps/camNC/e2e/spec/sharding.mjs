import assert from 'node:assert/strict';

export function parseShard(value) {
  assert(/^[1-9]\d*\/[1-9]\d*$/.test(value), 'Shard must be index/count, for example 1/2');
  const [index, count] = value.split('/').map(Number);
  assert(Number.isSafeInteger(index) && Number.isSafeInteger(count) && index <= count, 'Invalid shard index/count');
  return { index, count };
}

/** Long scenarios first, assigned by step count. Stable IDs break ties independently of filesystem order. */
export function selectShard(scenarios, shard) {
  if (!shard) return scenarios;
  assert(shard.count <= scenarios.length, 'Cannot create empty scenario shards');
  const bins = Array.from({ length: shard.count }, () => ({ weight: 0, ids: new Set() }));
  const ordered = [...scenarios].sort((a, b) => b.steps.length - a.steps.length || a.id.localeCompare(b.id, 'en'));
  for (const scenario of ordered) {
    const bin = bins.reduce((best, next) => next.weight < best.weight ? next : best);
    bin.ids.add(scenario.id);
    bin.weight += Math.max(1, scenario.steps.length);
  }
  return scenarios.filter(scenario => bins[shard.index - 1].ids.has(scenario.id));
}
