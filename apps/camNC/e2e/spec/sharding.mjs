import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { balancedShards } from '../../../../scripts/balanced-shards.mjs';
const weights = JSON.parse(readFileSync(new URL('./duration-weights.json', import.meta.url), 'utf8')).weightsMs;
export const scenarioWeight = scenario => weights[scenario.id] ?? Math.max(10000, scenario.steps.length * 500);

export function parseShard(value) {
  assert(/^[1-9]\d*\/[1-9]\d*$/.test(value), 'Shard must be index/count, for example 1/2');
  const [index, count] = value.split('/').map(Number);
  assert(Number.isSafeInteger(index) && Number.isSafeInteger(count) && index <= count, 'Invalid shard index/count');
  return { index, count };
}

/** Measured long scenarios are separated across runners; new scenarios receive a conservative estimate. */
export function selectShard(scenarios, shard) {
  if (!shard) return scenarios;
  assert(shard.count <= scenarios.length, 'Cannot create empty scenario shards');
  const selected = new Set(balancedShards(scenarios, shard.count, scenario => scenario.id, scenarioWeight)[shard.index - 1].map(scenario => scenario.id));
  return scenarios.filter(scenario => selected.has(scenario.id));
}
