import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

/** File durations are summed CPU/page time, not the wall time of a parallel run. */
export function summarizeFiles(files, root) {
  return files.map(file => ({
    file: path.relative(root, file.filepath).split(path.sep).join('/'),
    state: file.result?.state ?? 'not-run',
    testsMs: file.result?.duration ?? 0,
    collectMs: file.collectDuration ?? 0,
    setupMs: file.setupDuration ?? 0,
    environmentMs: file.environmentLoad ?? 0,
    prepareMs: file.prepareDuration ?? 0,
  })).sort((a, b) => b.testsMs + b.collectMs - a.testsMs - a.collectMs);
}

export default class TimingReporter {
  constructor({ suite = 'tests' } = {}) { this.suite = suite; }
  onInit(ctx) { this.root = ctx.config.root; this.shard = ctx.config.shard; this.started = performance.now(); }
  onFinished(files = [], errors = []) {
    const report = { suite: this.suite, shard: this.shard, wallMs: performance.now() - this.started,
      unhandledErrors: errors.length, files: summarizeFiles(files, this.root) };
    const directory = path.join(this.root, 'test-results');
    mkdirSync(directory, { recursive: true });
    const shard = this.shard ? `-${this.shard.index}-of-${this.shard.count}` : '';
    writeFileSync(path.join(directory, `${this.suite}${shard}.json`), JSON.stringify(report, null, 2) + '\n');
    console.log(`\n${this.suite}: ${(report.wallMs / 1000).toFixed(1)} s wall; slowest files (tests / collection):`);
    for (const file of report.files.slice(0, 10)) console.log(`  ${(file.testsMs / 1000).toFixed(2)}s / ${(file.collectMs / 1000).toFixed(2)}s ${file.file}`);
  }
}
