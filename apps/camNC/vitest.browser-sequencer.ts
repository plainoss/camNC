import path from 'node:path';
import { BaseSequencer, type TestSpecification } from 'vitest/node';
import { balancedShards } from '../../scripts/balanced-shards.mjs';
import durations from './vitest.duration-weights.json';

const weights: Record<string, number> = durations.weightsMs;
const key = (file: TestSpecification) => path.relative(file.project.config.root, file.moduleId).split(path.sep).join('/');
const weight = (file: TestSpecification) => weights[key(file)] ?? 5000;

export class BalancedBrowserSequencer extends BaseSequencer {
  async shard(files: TestSpecification[]) {
    const shard = this.ctx.config.shard;
    if (!shard) return files;
    return balancedShards(files, shard.count, key, weight)[shard.index - 1];
  }
  async sort(files: TestSpecification[]) {
    return [...files].sort((a, b) => weight(b) - weight(a) || key(a).localeCompare(key(b), 'en'));
  }
}
