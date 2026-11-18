import assert from 'node:assert/strict';
import { parseShard, selectShard, scenarioWeight } from './sharding.mjs';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { openPage, startDevServer } from './harness.mjs';
import { shotPath } from './shots.mjs';
import { junitReport } from './junit.mjs';
import { failsRun, scenarioResult } from './results.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(args) {
  const options = { url: null, only: '', headed: false, list: false, update: false, workers: 4, shard: null, files: [] };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--') continue;
    if (flag.startsWith('--shard=')) { options.shard = parseShard(flag.slice(8)); continue; }
    if (flag === '--url') options.url = args[++i];
    else if (flag === '--only') options.only = args[++i];
    else if (flag === '--file') options.files.push(path.resolve(process.env.INIT_CWD ?? process.cwd(), args[++i]));
    else if (flag === '--headed') options.headed = true;
    else if (flag === '--list') options.list = true;
    else if (flag === '--update-goldens') options.update = true;
    else if (flag === '--shard') options.shard = parseShard(args[++i]);
    else if (flag === '--workers') options.workers = Math.max(1, Number(args[++i]) || 1);
    else throw new Error(`Unknown option: ${flag}`);
  }
  return options;
}

/** Scenarios kept outside `scenarios/`, such as a checkout of specs. Files their steps write land next to them. */
async function loadFiles(files) {
  const scenarios = [];
  for (const file of files) {
    for (const scenario of JSON.parse(await readFile(file, 'utf8'))) {
      assert(scenario.id && scenario.title && scenario.evidence, `${file}: every scenario needs an id, a title and evidence`);
      scenarios.push({ ...scenario, baseDir: path.dirname(file) });
    }
  }
  return scenarios;
}

async function loadScenarios(only) {
  const scenarios = [];
  const base = path.join(root, 'scenarios');
  for (const domain of await readdir(base)) {
    for (const file of (await readdir(path.join(base, domain))).filter(name => name.endsWith('.json')).sort()) {
      const list = JSON.parse(await readFile(path.join(base, domain, file), 'utf8'));
      for (const scenario of list) {
        assert(scenario.id?.startsWith(`${domain}/`), `${file}: ${scenario.id} must start with ${domain}/`);
        assert(scenario.title && scenario.evidence, `${scenario.id} needs a title and evidence`);
        assert(!scenarios.some(other => other.id === scenario.id), `Duplicate scenario ${scenario.id}`);
        scenarios.push(scenario);
      }
    }
  }
  return scenarios.filter(scenario => scenario.id.startsWith(only));
}

/** Same drawing within 2 px: same elements in the same order, every number close. */
function sameSvg(actual, golden) {
  const tokens = text => text.split(/(-?\d+(?:\.\d+)?)/);
  const a = tokens(actual);
  const b = tokens(golden);
  if (a.length !== b.length) return false;
  return a.every((token, i) => (i % 2 ? Math.abs(Number(token) - Number(b[i])) <= 2 : token === b[i]));
}

async function compareFrame(scenario, name, svg, options, outDir) {
  const file = `${scenario.id.replaceAll('/', '.')}.${name}.svg`;
  const golden = path.join(root, 'goldens', scenario.id.split('/')[0], file);
  await writeFile(path.join(outDir, file), svg);
  if (options.update) {
    await mkdir(path.dirname(golden), { recursive: true });
    await writeFile(golden, svg);
    return null;
  }
  if (!existsSync(golden)) return null;
  return sameSvg(svg, await readFile(golden, 'utf8')) ? null : `frame ${name} differs from its golden; see ${path.join(outDir, file)}`;
}

async function runScenario(browser, scenario, options, outDir) {
  const started = performance.now();
  const { createAdapter } = await import(`./adapters/${scenario.id.split('/')[0]}.mjs`);
  const { context, page, runtime } = await openPage(browser);
  const failures = [];
  let phase = 'bootstrap';
  let bootstrapMs = 0;
  try {
    const adapter = await createAdapter(page, options.url, scenario.baseDir ? { baseDir: scenario.baseDir } : undefined);
    bootstrapMs = performance.now() - started;
    page.setDefaultTimeout(8000);
    for (const [index, step] of scenario.steps.entries()) {
      phase = `step ${index + 1}`;
      // A `spec` marker only says where a written spec's step starts; the lint reads it, the run skips it.
      if (typeof step === 'object' && 'spec' in step) continue;
      if (typeof step === 'object') {
        await adapter.settle();
        failures.push(...(await adapter.check(step.expect)).map(failure => `step ${index + 1}: ${failure}`));
      } else if (step === 'shot' || step.startsWith('shot ')) {
        // As in a session: a picture of the page now, settled. A file scenario's picture lands next to it.
        await adapter.settle();
        await page.screenshot({ path: shotPath(scenario, step.slice(5).trim(), outDir) });
      } else if (step.startsWith('frame ')) {
        await adapter.settle();
        const failure = await compareFrame(scenario, step.slice(6), await adapter.frame(), options, outDir);
        if (failure) failures.push(failure);
      } else {
        await adapter.step(step);
      }
    }
    await adapter.settle();
  } catch (error) {
    failures.push(`stopped during ${phase}: ${String(error.message).split('\n').slice(0, 12).join('\n        ')}`);
  }
  failures.push(...runtime);
  if (failures.length) await page.screenshot({ path: path.join(outDir, `${scenario.id.replaceAll('/', '.')}.png`) }).catch(() => {});
  await context.close();
  return { failures, bootstrapMs, durationMs: performance.now() - started };
}

const options = parseArgs(process.argv.slice(2));
assert(!(options.update && options.shard), 'Golden updates must run without sharding');
const scenarios = selectShard(options.files.length ? await loadFiles(options.files) : await loadScenarios(options.only), options.shard);
assert(scenarios.length > 0, 'No scenarios selected');
const runStarted = performance.now();
if (options.list) {
  for (const scenario of scenarios) console.log(`${scenario.id}  ${scenario.title}`);
  process.exit(0);
}
const shardName = options.shard ? `${options.shard.index}-of-${options.shard.count}` : 'all';
const outDir = fileURLToPath(new URL(`../../test-results/spec/${shardName}/`, import.meta.url));
const junitDir = fileURLToPath(new URL('../../test-results/junit/', import.meta.url));
await mkdir(outDir, { recursive: true });
let server = null;
if (!options.url) {
  server = await startDevServer();
  options.url = server.url;
}
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ headless: !options.headed });
const counts = { PASS: 0, FAIL: 0, XFAIL: 0, XPASS: 0, FLAKY: 0 };
const results = [];
const run = async (scenario, index) => {
  const { failures, bootstrapMs, durationMs } = await runScenario(browser, scenario, options, outDir);
  const result = scenarioResult(scenario, failures);
  counts[result]++;
  results[index] = { id: scenario.id, result, failures, bootstrapMs, durationMs };
  const lines = [`${result.padEnd(5)} ${scenario.id}`];
  if (result === 'FAIL' || result === 'FLAKY') lines.push(...failures.map(failure => `        ${failure}`));
  if (result === 'FLAKY') lines.push(`        quarantined: ${scenario.flaky}`);
  if (result === 'XFAIL') lines.push(`        known: ${scenario.known}`);
  if (result === 'XPASS') lines.push(`        now passes; remove known: ${scenario.known}`);
  console.log(lines.join('\n'));
};
// The first scenario runs alone, so the dev server's cold start can't eat into the timeouts of several at once.
if (scenarios.length) await run(scenarios[0], 0);
// Rewriting goldens stays serial, so a run can be compared with what it replaced in order.
const workers = options.update ? 1 : options.workers;
// Warm a normal scenario first, then start the long machine workflows before the short tail.
if (!options.update && scenarios.length > 1) {
  const tail = scenarios.splice(1).sort((a, b) => scenarioWeight(b) - scenarioWeight(a) || a.id.localeCompare(b.id, 'en'));
  scenarios.push(...tail);
}
let next = 1;
await Promise.all(
  Array.from({ length: workers }, async () => {
    while (next < scenarios.length) {
      const index = next++;
      await run(scenarios[index], index);
    }
  })
);
await browser.close();
server?.stop();
await writeFile(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2) + '\n');
await writeFile(path.join(outDir, 'summary.json'), JSON.stringify({ shard: options.shard, workers, wallMs: performance.now() - runStarted, scenarios: scenarios.length, counts }, null, 2) + '\n');
// Outside the cached test-results/spec, so a replayed run leaves no report for CI to upload as this commit's results.
await mkdir(junitDir, { recursive: true });
await writeFile(path.join(junitDir, `spec-${shardName}.xml`), junitReport(results));
console.log(`\n${scenarios.length} scenarios: ${counts.PASS} pass, ${counts.FAIL} fail, ${counts.XFAIL} known gaps, ${counts.XPASS} newly passing, ${counts.FLAKY} quarantined failures`);
if (failsRun(counts)) process.exitCode = 1;
