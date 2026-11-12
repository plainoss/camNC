import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Rewrites the shard duration weights from downloaded CI artifacts, one directory per run, named by its run ID:
 *   gh run download <id> -R plainoss/camNC -p 'test-timings-app-browser-*' -p 'behaviour-specs-*' -D <dir>/<id>
 *   node scripts/refresh-duration-weights.mjs <dir>/<id> [<dir>/<id> ...]
 * Each weight is the median of the passing measurements across runs, so one slow runner does not move a file.
 */

const repository = 'https://github.com/plainoss/camNC/actions/runs/';

function jsonFiles(directory, match) {
  return readdirSync(directory, { recursive: true }).map(String).filter(file => match(path.basename(file))).map(file => path.join(directory, file));
}

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Collects every run's samples per key and keeps the rounded median, ordered by key for stable diffs. */
export function medianWeights(runs) {
  const samples = new Map();
  for (const run of runs) for (const [key, ms] of run) samples.set(key, [...(samples.get(key) ?? []), ms]);
  return Object.fromEntries([...samples].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, values]) => [key, Math.round(median(values))]));
}

/** Browser files weigh their test plus collection time, the order the timing reporter ranks them in. */
export function browserSamples(reports) {
  return reports.flatMap(report => report.files.filter(file => file.state === 'pass').map(file => [file.file, file.testsMs + file.collectMs]));
}

/** Behaviour scenarios weigh their whole duration, including the page bootstrap each one pays. */
export function scenarioSamples(results) {
  return results.filter(result => result.result === 'PASS' || result.result === 'FLAKY').map(result => [result.id, result.durationMs]);
}

function write(file, runIds, weightsMs, previous) {
  const { sourceRun: _, sourceRuns: __, weightsMs: ___, ...kept } = previous;
  writeFileSync(file, JSON.stringify({ sourceRuns: runIds.map(id => repository + id), ...kept, weightsMs }, null, 2) + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const directories = process.argv.slice(2);
  if (!directories.length) throw new Error('Pass one downloaded artifact directory per CI run');
  const runIds = directories.map(directory => path.basename(path.resolve(directory)));
  const read = file => JSON.parse(readFileSync(file, 'utf8'));
  const browser = directories.map(directory => browserSamples(jsonFiles(directory, name => /^browser-\d+-of-\d+\.json$/.test(name)).map(read)));
  const specs = directories.map(directory => scenarioSamples(jsonFiles(directory, name => name === 'results.json').flatMap(read)));
  const root = new URL('../apps/camNC/', import.meta.url);
  const browserFile = new URL('vitest.duration-weights.json', root);
  const specFile = new URL('e2e/spec/duration-weights.json', root);
  write(browserFile, runIds, medianWeights(browser), read(browserFile));
  write(specFile, runIds, medianWeights(specs), read(specFile));
  console.log(`Wrote ${browser.flat().length} browser and ${specs.flat().length} scenario samples from ${runIds.length} runs`);
}
