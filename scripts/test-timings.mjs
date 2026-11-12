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

/**
 * The tests that failed a try and passed on a retry, as `file > describe > test`, the name a FAIL line gives them.
 * scripts/flaky-tests.mjs reads the RETRIED lines the reporter prints, so a retry never hides a flake.
 */
export function retriedTests(files, root) {
  return testsWhere(files, root, result => result?.state === 'pass' && (result.retryCount ?? 0) > 0);
}

/** The `file > describe > test` names of the tests that failed. */
export function failedTests(files, root) {
  return testsWhere(files, root, result => result?.state === 'fail');
}

function testsWhere(files, root, matches) {
  const found = [];
  const walk = (task, names, file) => {
    for (const child of task.tasks ?? []) {
      const path = [...names, child.name];
      if (child.type === 'suite') walk(child, path, file);
      else if (matches(child.result)) found.push([file, ...path].join(' > '));
    }
  };
  for (const file of files) walk(file, [], path.relative(root, file.filepath).split(path.sep).join('/'));
  return found;
}

export default class TimingReporter {
  constructor({ suite = 'tests' } = {}) { this.suite = suite; }
  onInit(ctx) { this.root = ctx.config.root; this.shard = ctx.config.shard; this.started = performance.now(); }
  onFinished(files = [], errors = []) {
    const run = process.env.GITHUB_RUN_ID ?? 'local';
    // The non-gating run of quarantined tests (scripts/test-quarantine.mjs) reports its failures, and keeps the shard
    // timings the real run wrote.
    if (process.env.VITEST_QUARANTINE_ONLY) {
      for (const test of failedTests(files, this.root)) console.log(`QUARANTINE FAILED [run ${run}] ${test}`);
      return;
    }
    const report = { suite: this.suite, shard: this.shard, wallMs: performance.now() - this.started,
      unhandledErrors: errors.length, files: summarizeFiles(files, this.root) };
    const directory = path.join(this.root, 'test-results');
    mkdirSync(directory, { recursive: true });
    const shard = this.shard ? `-${this.shard.index}-of-${this.shard.count}` : '';
    writeFileSync(path.join(directory, `${this.suite}${shard}.json`), JSON.stringify(report, null, 2) + '\n');
    console.log(`\n${this.suite}: ${(report.wallMs / 1000).toFixed(1)} s wall; slowest files (tests / collection):`);
    for (const file of report.files.slice(0, 10)) console.log(`  ${(file.testsMs / 1000).toFixed(2)}s / ${(file.collectMs / 1000).toFixed(2)}s ${file.file}`);
    // Tagged with the run, since turbo replays these lines from its cache in later runs that retried nothing.
    for (const test of retriedTests(files, this.root)) console.log(`RETRIED [run ${run}] ${test}`);
  }
}
