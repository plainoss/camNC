import { describe, expect, it } from 'vitest';
import type { TestSpecification, Vitest } from 'vitest/node';
import { BalancedBrowserSequencer } from '../../vitest.browser-sequencer';
import durations from '../../vitest.duration-weights.json';

const root = '/workspace/app';
const files = [...Object.keys(durations.weightsMs), 'src/new-workflow.test.tsx'];
const specification = (file: string) => ({ moduleId: `${root}/${file}`, project: { config: { root } } }) as TestSpecification;
const sequencer = (index: number, count: number) => new BalancedBrowserSequencer({ config: { shard: { index, count } } } as Vitest);

describe('browser duration sequencer', () => {
  it('implements Vitest shard/sort with complete, disjoint assignment including new files', async () => {
    const first = await sequencer(1, 2).shard(files.map(specification));
    const second = await sequencer(2, 2).shard(files.map(specification));
    expect([...first, ...second].map(file => file.moduleId).sort()).toEqual(files.map(file => `${root}/${file}`).sort());
    expect(first.every(file => !second.some(other => other.moduleId === file.moduleId))).toBe(true);
    const sorted = await sequencer(1, 2).sort(files.map(specification));
    const longest = Object.entries(durations.weightsMs).sort((a, b) => b[1] - a[1])[0]![0];
    expect(sorted[0]!.moduleId).toBe(`${root}/${longest}`);
  });
});
