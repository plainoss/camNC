import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { parseShard, selectShard, scenarioWeight } from '../apps/camNC/e2e/spec/sharding.mjs';

const directory = new URL('../apps/camNC/e2e/spec/scenarios/sketch/', import.meta.url);
const scenarios = readdirSync(directory).filter(file => file.endsWith('.json')).flatMap(file => JSON.parse(readFileSync(new URL(file, directory), 'utf8')));

test('every real behaviour scenario runs exactly once across deterministic balanced shards', () => {
  for (const count of [1, 2, 3, 4]) {
    const shards = Array.from({ length: count }, (_, i) => selectShard(scenarios, { index: i + 1, count }));
    assert.deepEqual(shards.flat().map(s => s.id).sort(), scenarios.map(s => s.id).sort());
    for (let index = 1; index <= count; index++) {
      assert.deepEqual(selectShard([...scenarios].reverse(), { index, count }).map(s => s.id).sort(), shards[index - 1].map(s => s.id).sort());
    }
    const weights = shards.map(list => list.reduce((sum, scenario) => sum + scenarioWeight(scenario), 0));
    assert(Math.max(...weights) - Math.min(...weights) <= Math.max(...scenarios.map(scenarioWeight)));
  }
});

test('bad shard arguments cannot quietly skip coverage', () => {
  for (const value of ['0/2', '3/2', '1/0', 'a/2', '1/2/3', '1.5/2', '9007199254740992/9007199254740992']) assert.throws(() => parseShard(value));
  assert.deepEqual(parseShard('2/3'), { index: 2, count: 3 });
  assert.throws(() => selectShard([], parseShard('1/2')));
});
