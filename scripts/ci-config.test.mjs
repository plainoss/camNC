import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { parse } from 'yaml';

const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
const lock = parse(read('pnpm-lock.yaml'));
const require = createRequire(import.meta.url);

for (const [workflow, job] of [['ci.yml', 'test'], ['ci.yml', 'specs'], ['setup-smoke.yml', 'setup-smoke']]) {
  test(`${workflow} ${job}: preinstalled browsers match the locked and installed Playwright versions`, () => {
    const { container } = parse(read(`.github/workflows/${workflow}`)).jobs[job];
    const version = lock.importers['.'].devDependencies.playwright.version;
    assert.equal(container.image, `mcr.microsoft.com/playwright:v${version}-noble`);
    assert.equal(require('playwright/package.json').version, version);
    // Vitest resolves Playwright from camNC, while smoke imports it from the repo root.
    const appRequire = createRequire(new URL('apps/camNC/package.json', root));
    assert.equal(appRequire('playwright/package.json').version, version);
  });
}

test('every file the fast test set skips still exists and CI still runs the full test task', () => {
  const skipped = JSON.parse(read('apps/camNC/vitest.fast-excludes.json'));
  assert(skipped.length >= 20);
  assert.equal(new Set(skipped).size, skipped.length);
  for (const file of skipped) assert(existsSync(new URL(`apps/camNC/${file}`, root)), `${file} is gone; update the list`);
  assert.doesNotMatch(read('.github/workflows/ci.yml'), /test:fast/);
});

test('browser test steps are bounded and the turbo cache action saves the directory turbo writes', () => {
  const { jobs } = parse(read('.github/workflows/ci.yml'));
  const step = (job, name) => jobs[job].steps.find(s => s.name === name);
  const tests = step('test', 'Run tests');
  assert(tests['timeout-minutes'] > 0);
  assert(step('specs', 'Run sketch behaviour specs')['timeout-minutes'] > 0);
  assert.match(tests.run, /--log-order=stream/);
  assert.equal(step('test', 'Cache Turborepo').with.path, tests.env.TURBO_CACHE_DIR);
});

test('the required Run tests check waits for every validation job and cannot hide failures', () => {
  const { jobs } = parse(read('.github/workflows/ci.yml'));
  const required = Object.values(jobs).filter(job => job.name === 'Run tests');
  assert.equal(required.length, 1, 'branch protection must have one unambiguous required check');
  const [gate] = required;
  assert.deepEqual([...gate.needs].sort(), Object.keys(jobs).filter(id => jobs[id] !== gate).sort());
  assert.equal(gate.if, 'always()');
  // An aggregate check must execute a real failure check, even when one of its dependencies fails or skips.
  for (const job of gate.needs) {
    assert(Object.values(gate.steps[0].env).includes('${{ needs.' + job + '.result }}'));
  }
});

test('the required check rejects a failed, cancelled or skipped dependency', () => {
  const gate = parse(read('.github/workflows/ci.yml')).jobs.results.steps[0];
  const allPassed = Object.fromEntries(Object.keys(gate.env).map(key => [key, 'success']));
  const run = statuses => spawnSync('bash', ['-e', '-c', gate.run], { env: { PATH: process.env.PATH, ...statuses } });
  assert.equal(run(allPassed).status, 0);
  for (const key of Object.keys(allPassed)) {
    for (const status of ['failure', 'cancelled', 'skipped']) {
      assert.notEqual(run({ ...allPassed, [key]: status }).status, 0, `${key}=${status} must fail the required check`);
    }
  }
});

test('CI covers every runtime task and both browser shards, without duplicating other tests', () => {
  const suites = parse(read('.github/workflows/ci.yml')).jobs.test.strategy.matrix.include;
  const selected = (tasks, filters) => {
    const plan = execFileSync(process.execPath, [require.resolve('turbo/bin/turbo'), 'run', ...tasks, ...filters, '--dry=json'], {
      cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    });
    return JSON.parse(plan).tasks.filter(task => tasks.includes(task.task) && task.command !== '<NONEXISTENT>').map(task => task.taskId);
  };
  const assigned = suites.flatMap(suite => selected(suite.tasks.split(/\s+/), suite.filter.split(/\s+/)));
  const expected = [
    ...selected(['test'], ['--filter=!@wbcnc/camNC']),
    ...selected(['test:domain', 'test:worker', 'test:licenses', 'test:browser'], ['--filter=@wbcnc/camNC']),
    '@wbcnc/camNC#test:browser',
  ];
  assert.deepEqual(assigned.sort(), expected.sort());
  assert.deepEqual(suites.filter(suite => suite.tasks === 'test:browser').map(suite => suite.args).sort(), ['--shard=1/2', '--shard=2/2']);
  const scripts = JSON.parse(read('package.json')).scripts;
  assert.deepEqual(suites.map(suite => suite.performance).filter(Boolean).sort(), scripts['test:performance'].split(' && ').sort());
  const specs = parse(read('.github/workflows/ci.yml')).jobs.specs;
  assert.deepEqual(specs.strategy.matrix.shard, ['1/4', '2/4', '3/4', '4/4']);
  assert.match(specs.steps.find(step => step.name === 'Run sketch behaviour specs').run, /--shard=\$\{\{ matrix.shard \}\}/);
});


test('merge queue runs all validation and isolates concurrent candidate builds', () => {
  const workflow = parse(read('.github/workflows/ci.yml'));
  assert.deepEqual(workflow.on.merge_group.types, ['checks_requested']);
  assert(workflow.on.pull_request, 'ordinary PR checks must still run');
  assert(workflow.on.push, 'main checks must still run');
  assert.equal(workflow.concurrency.group, 'ci-${{ github.event.pull_request.number || github.run_id }}');
  assert.equal(workflow.concurrency['cancel-in-progress'], "${{ github.event_name == 'pull_request' }}");
  for (const [id, job] of Object.entries(workflow.jobs)) {
    assert.equal(job.if, id === 'results' ? 'always()' : undefined,
      `${id} must not skip validation on merge_group events`);
  }
});


test('production smoke accepts Cloudflare production checks after queue merges and rejects previews', () => {
  const condition = parse(read('.github/workflows/setup-smoke.yml')).jobs['setup-smoke'].if;
  // Exercise the configured expression against event payloads, including GitHub's retained queue branch name.
  const evaluate = new Function('github', 'contains', `return (${condition});`);
  const check = (overrides = {}) => ({
    event_name: 'check_run',
    event: { check_run: {
      conclusion: 'success',
      name: 'Workers Builds: camnc',
      app: { slug: 'cloudflare-workers-and-pages' },
      check_suite: { head_branch: 'gh-readonly-queue/main/pr-166-example' },
      ...overrides,
    } },
  });
  const passes = event => evaluate(event, (value, part) => value.includes(part));
  assert.equal(passes(check()), true, 'production checks must work when the queue branch name is retained');
  assert.equal(passes(check({ name: 'Workers Builds: camnc-preview' })), false);
  assert.equal(passes(check({ name: 'Workers Builds: camnc-webrtc-cam' })), false);
  assert.equal(passes(check({ conclusion: 'failure' })), false);
  assert.equal(passes(check({ app: { slug: 'another-app' } })), false);
  assert.equal(passes({ event_name: 'workflow_dispatch' }), true);
  assert.equal(passes({ event_name: 'schedule' }), true);
});


test('the explicit Node test allocation is disjoint from browser and storage integration coverage', () => {
  assert(read('vitest.workspace.ts').includes('./apps/*/vitest.node.config.ts'), 'workspace and IDE runs must include domain tests');
  const node = JSON.parse(read('apps/camNC/vitest.node-files.json'));
  assert.equal(new Set(node).size, node.length);
  for (const file of node) assert(existsSync(new URL(`apps/camNC/${file}`, root)), file);
  const browser = read('apps/camNC/vitest.config.ts');
  assert.match(browser, /exclude:.*\.\.\.nodeFiles/);
  assert.match(read('apps/camNC/vitest.node.config.ts'), /include: files/);
  assert(!node.some(file => /jobDb|solveCad|workers\//.test(file)), 'platform adapters retain real browser coverage');
  const scripts = JSON.parse(read('apps/camNC/package.json')).scripts;
  for (const task of ['licenses', 'domain', 'worker', 'browser']) assert(scripts.test.includes(`test:${task}`));
});

test('headless workspace packages cannot import app or browser state adapters', () => {
  for (const pkg of ['cad-editor', 'cam-settings']) {
    const manifest = JSON.parse(read(`packages/${pkg}/package.json`));
    assert.deepEqual(Object.keys(manifest.dependencies), [pkg === 'cad-editor' ? '@wbcnc/cad' : '@wbcnc/cam']);
    for (const file of readdirSync(new URL(`packages/${pkg}/src`, root)).filter(file => file.endsWith('.ts'))) {
      const source = read(`packages/${pkg}/src/${file}`);
      for (const match of source.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)) {
        assert(!/^(?:@\/|react(?:-dom)?$|zustand|comlink)|apps\//.test(match[1]), `${pkg}/${file}: ${match[1]}`);
      }
    }
  }
});

test('worker cache includes its schema and migrations while browser tasks exclude worker-only edits', () => {
  const { tasks } = JSON.parse(read('apps/camNC/turbo.json'));
  assert(tasks['test:worker'].inputs.includes('worker/**'));
  assert(tasks['test:worker'].inputs.includes('migrations/**'));
  for (const task of ['test:browser', 'spec:cad']) {
    assert(tasks[task].inputs.includes('$TURBO_DEFAULT$'), 'unknown new app files must invalidate the cache');
    assert(tasks[task].inputs.includes('!worker/**'));
    assert(tasks[task].inputs.includes('!migrations/**'));
  }
});


test('scoped app task caches do not inherit the entire app through a same-package transit node', () => {
  const tasks = ['test:worker', 'test:licenses', 'test:browser', 'spec:cad'];
  const plan = JSON.parse(execFileSync(process.execPath, [require.resolve('turbo/bin/turbo'), 'run', ...tasks, '--filter=@wbcnc/camNC', '--dry=json'], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
  for (const name of tasks) {
    const task = plan.tasks.find(task => task.taskId === `@wbcnc/camNC#${name}`);
    assert(task, name);
    assert(!task.dependencies.includes('@wbcnc/camNC#transit'), `${name} must not hash excluded app sources via transit`);
    assert(task.dependencies.includes('@wbcnc/cad-editor#transit'), 'workspace source dependencies must still invalidate results');
  }
});
