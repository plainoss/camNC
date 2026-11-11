import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { parse } from 'yaml';

const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
const lock = parse(read('pnpm-lock.yaml'));
const require = createRequire(import.meta.url);

// Evaluates a workflow `if:` the way Actions would for these tests: `always()` is true, as for a gate after a failed
// dependency, and `a.*.b` maps over a list.
const actionsIf = (expression, github) =>
  new Function('github', 'always', 'contains', 'fromJSON', 'startsWith', `return (${expression.replace(/\.\*\.(\w+)/g, '.map(item => item.$1)')});`)(
    { event: {}, ...github },
    () => true,
    (list, item) => list.includes(item),
    JSON.parse,
    (value, prefix) => (value ?? '').startsWith(prefix)
  );

test('desktop cache restores rediscover CMake tools while preserving compiled artifacts', t => {
  const steps = parse(read('.github/workflows/desktop.yml')).jobs.build.steps;
  const resetIndex = steps.findIndex(step => step.name === 'Reset restored CMake configuration');
  assert(resetIndex > steps.findIndex(step => step.uses === 'Swatinem/rust-cache@v2'));
  assert(resetIndex > steps.findIndex(step => step.name === 'Cache macOS CEF helper'));
  assert(resetIndex < steps.findIndex(step => step.name === 'Build'));
  const reset = steps[resetIndex];
  assert.equal(reset.if, undefined, 'every platform must reset restored CMake configuration');

  const cwd = mkdtempSync(join(tmpdir(), 'desktop-cmake-cache-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const run = () => {
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', reset.run], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  run(); // A first build has no target directory.
  const target = join(cwd, 'apps/camnc-desktop/src-tauri/target');
  const caches = [
    'release/build/cef-dll-sys-123/out/build/CMakeCache.txt',
    'tauri-cef-helper/target/release/build/cef-dll-sys-456/out/build/CMakeCache.txt',
  ];
  const retained = [
    'release/deps/libcef.rlib',
    'release/build/cef-dll-sys-123/out/build/CMakeFiles/wrapper.dir/wrapper.cc.o',
    'tauri-cef-helper/target/release/tauri-cef-helper',
  ];
  for (const file of [...caches, ...retained]) {
    const dest = join(target, file);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, 'cached');
  }
  run();
  for (const file of caches) assert(!existsSync(join(target, file)), `${file} must be regenerated`);
  for (const file of retained) assert.equal(readFileSync(join(target, file), 'utf8'), 'cached');
});

for (const [workflow, job] of [['ci.yml', 'test'], ['ci.yml', 'browser'], ['ci.yml', 'specs'], ['setup-smoke.yml', 'setup-smoke']]) {
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
  assert.equal(gate.if, "always() && github.event_name != 'push'");
  // An aggregate check must execute a real failure check, even when one of its dependencies fails or skips.
  for (const job of gate.needs) {
    assert(Object.values(gate.steps[0].env).includes('${{ needs.' + job + '.result }}'));
  }
});

test('the required check rejects a failed, cancelled or skipped dependency', () => {
  const gate = parse(read('.github/workflows/ci.yml')).jobs.results.steps[0];
  const results = Object.keys(gate.env).filter(key => key.endsWith('_RESULT'));
  const allPassed = { ...Object.fromEntries(results.map(key => [key, 'success'])), QUEUE_ONLY_OPTIONAL: 'false' };
  const run = statuses => spawnSync('bash', ['-e', '-c', gate.run], { env: { PATH: process.env.PATH, ...statuses } });
  assert.equal(run(allPassed).status, 0);
  for (const key of results) {
    for (const status of ['failure', 'cancelled', 'skipped']) {
      assert.notEqual(run({ ...allPassed, [key]: status }).status, 0, `${key}=${status} must fail the required check`);
    }
  }
  // Only a PR without `full-ci` may skip the browser shards and specs, and even there they must not fail.
  const light = { ...allPassed, QUEUE_ONLY_OPTIONAL: 'true' };
  assert.equal(run({ ...light, BROWSER_RESULT: 'skipped', SPECS_RESULT: 'skipped' }).status, 0);
  assert.notEqual(run({ ...light, SPECS_RESULT: 'failure' }).status, 0);
  assert.notEqual(run({ ...light, BROWSER_RESULT: 'cancelled' }).status, 0);
  assert.notEqual(run({ ...light, SIM_RESULT: 'skipped' }).status, 0);
});

test('CI covers every runtime task and both browser shards, without duplicating other tests', () => {
  const { jobs } = parse(read('.github/workflows/ci.yml'));
  const suites = [...jobs.test.strategy.matrix.include, ...jobs.browser.strategy.matrix.include];
  const selected = (tasks, filters) => {
    const plan = execFileSync(process.execPath, [require.resolve('turbo/bin/turbo'), 'run', ...tasks, ...filters, '--dry=json'], {
      cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    });
    // A task is either a name for every filtered package or a package#task id that runs regardless of the filter.
    return JSON.parse(plan).tasks
      .filter(task => (tasks.includes(task.task) || tasks.includes(task.taskId)) && task.command !== '<NONEXISTENT>')
      .map(task => task.taskId);
  };
  const assigned = suites.flatMap(suite => selected(suite.tasks.split(/\s+/), suite.filter.split(/\s+/)));
  const expected = [
    ...selected(['test'], ['--filter=!@wbcnc/camNC']),
    ...selected(['test:domain', 'test:worker', 'test:licenses', 'test:browser'], ['--filter=@wbcnc/camNC']),
    '@wbcnc/camNC#test:browser',
  ];
  assert.deepEqual(assigned.sort(), expected.sort());
  assert.deepEqual(suites.filter(suite => suite.tasks === 'test:browser').map(suite => suite.args).sort(), ['--shard=1/2', '--shard=2/2']);
  // Both gates run serially in one job, after its functional tests, and never through turbo's cache.
  assert.deepEqual(suites.map(suite => suite.performance).filter(Boolean), ['pnpm run test:performance']);
  const scripts = JSON.parse(read('package.json')).scripts;
  assert.match(scripts['test:performance'], /^pnpm --filter @wbcnc\/cam test:performance && pnpm --filter @wbcnc\/camNC test:performance$/);
  const steps = parse(read('.github/workflows/ci.yml')).jobs.test.steps.map(step => step.name);
  assert(steps.indexOf('Performance gates') > steps.indexOf('Run tests'));
  // The headless suites share a runner one task at a time; each browser shard has a runner to itself.
  const headless = suites.filter(suite => suite.tasks !== 'test:browser');
  assert.deepEqual(headless.map(suite => suite.suite), ['headless']);
  assert.match(headless[0].filter, /--concurrency=1/);
  // Local cold runs must not multiply several independent CAD/WASM worker pools
  // on the same host while CI runs those packages one at a time.
  for (const name of ['test', 'test:fast']) {
    const command = scripts[name].split(' && ')[0];
    const turboOptions = command.slice(0, command.indexOf(' -- '));
    assert.match(turboOptions, /--concurrency=1(?:\s|$)/, `${name} must serialize its headless packages like CI`);
    assert.doesNotMatch(turboOptions, /--parallel(?:\s|$)/, '--parallel would ignore the worker budget');
  }
  const specs = parse(read('.github/workflows/ci.yml')).jobs.specs;
  assert.deepEqual(specs.strategy.matrix.shard, ['1/4', '2/4', '3/4', '4/4']);
  assert.match(specs.steps.find(step => step.name === 'Run sketch behaviour specs').run, /--shard=\$\{\{ matrix.shard \}\}/);
});


test('the Mergify queue runs all validation, PRs run the quick suites and main only warms caches', () => {
  const workflow = parse(read('.github/workflows/ci.yml'));
  assert.equal(workflow.on.merge_group, undefined, 'Mergify batches are pull requests; GitHub merge groups are gone');
  assert(workflow.on.pull_request, 'ordinary PR checks must still run');
  assert(workflow.on.push, 'main checks must still run');
  assert.equal(workflow.concurrency.group, 'ci-${{ github.event.pull_request.number || github.run_id }}');
  assert.equal(workflow.concurrency['cancel-in-progress'], "${{ github.event_name == 'pull_request' }}");
  const pr = (labels, head_ref = 'feature/example') => ({
    event_name: 'pull_request',
    head_ref,
    event: { pull_request: { labels: labels.map(name => ({ name })) } },
  });
  const runs = (job, github) => job.if === undefined || actionsIf(job.if, github);
  for (const [id, job] of Object.entries(workflow.jobs)) {
    for (const github of [pr([], 'mergify/merge-queue/main/batch-example'), pr(['full-ci'])]) {
      assert(runs(job, github), `${id} must not skip validation on ${github.event_name} events`);
    }
  }
  // A PR runs the quick suites; a Mergify batch validates the whole batch with everything once.
  const onPr = Object.keys(workflow.jobs).filter(id => runs(workflow.jobs[id], pr(['enhancement'])));
  assert.deepEqual(onPr.sort(), ['checks', 'fluidnc-sim', 'results', 'test']);
  // A PR runs only the headless matrix entry; the browser shards are their own job, so no include adds them back.
  assert.deepEqual(workflow.jobs.test.strategy.matrix.include.map(entry => entry.suite), ['headless']);
  assert(onPr.every(id => workflow.jobs[id].strategy?.matrix?.exclude === undefined));
  assert.deepEqual(workflow.jobs.browser.steps, workflow.jobs.test.steps, 'browser shards run the same steps as test');
  assert.deepEqual(workflow.jobs.browser.container, workflow.jobs.test.container);
  // The queue validated the commit that lands on main, so main only warms caches through the checks job.
  const onMain = Object.keys(workflow.jobs).filter(id => runs(workflow.jobs[id], { event_name: 'push' }));
  assert.deepEqual(onMain, ['checks']);
  for (const [job, step] of [['test', 'Run tests'], ['specs', 'Run sketch behaviour specs']]) {
    assert.match(workflow.jobs[job].steps.find(entry => entry.name === step).env.TURBO_FORCE, /schedule/, `${step} must not replay cached results on scheduled runs`);
  }
  // Scheduled and manual runs on main run every suite, so Mergify's flaky-test detection sees the tests on main.
  assert(workflow.on.schedule?.length, 'main must run the full suites on a schedule');
  for (const event_name of ['schedule', 'workflow_dispatch']) {
    for (const [id, job] of Object.entries(workflow.jobs)) {
      assert(runs(job, { event_name, head_ref: '', event: {} }), `${id} must run on ${event_name}`);
    }
  }
});

test('Mergify batches retain the required gate, branch protections and explicit merge consent', () => {
  const config = parse(read('.mergify.yml'));
  assert.equal(config.pull_request_rules, undefined, 'CI success must not automatically request a merge');
  assert.equal(config.merge_protections_settings?.auto_merge_conditions, undefined);
  assert.equal(config.merge_queue.mode, 'serial', 'speculative batches must include preceding changes');
  assert(config.merge_queue.max_parallel_checks > 1 && config.merge_queue.max_parallel_checks <= 2);
  assert.equal(config.merge_queue.skip_intermediate_results ?? false, false);
  assert.equal(config.queue_rules.length, 1);
  const [queue] = config.queue_rules;
  assert(queue.queue_conditions.includes('base = main'));
  assert(queue.queue_conditions.includes('-draft'));
  assert.equal(queue.branch_protection_injection_mode, 'queue');
  assert.equal(queue.merge_method, 'squash');
  assert(queue.batch_size > 1 && queue.batch_size <= 3);
  assert.equal(queue.max_checks_retries, 0);
  const required = Object.values(parse(read('.github/workflows/ci.yml')).jobs).find(job => job.name === 'Run tests');
  assert(required);
  for (const conditions of [queue.queue_conditions, queue.merge_conditions]) {
    assert(conditions.includes(`check-success = ${required.name}`), 'both original PRs and batches must pass their validation gate');
  }
  const { jobs } = parse(read('.github/workflows/ci.yml'));
  const browserChecks = jobs.browser.strategy.matrix.include.map(({ suite }) => `Tests (${suite})`);
  const specChecks = jobs.specs.strategy.matrix.shard.map(shard => `Behaviour specs (${shard})`);
  assert.deepEqual(queue.merge_conditions.filter(condition => !queue.queue_conditions.includes(condition)).sort(),
    [...browserChecks, ...specChecks].map(name => `check-success = ${name}`).sort(),
    'distinct merge conditions must require all browser/spec checks, preventing direct merge after only light PR CI');
});

test('Mergify draft batch PRs trigger all validation without needing merge_group events', () => {
  const workflow = parse(read('.github/workflows/ci.yml'));
  const trigger = workflow.on.pull_request;
  assert(trigger.branches.includes('main'));
  assert.equal(trigger.paths, undefined);
  assert.equal(trigger['paths-ignore'], undefined);
  for (const action of ['opened', 'synchronize', 'reopened']) {
    assert(trigger.types === undefined || trigger.types.includes(action));
  }
  const github = {
    event_name: 'pull_request',
    head_ref: 'mergify/merge-queue/main/batch-example',
    event: { pull_request: { labels: [], draft: true, user: { login: 'mergify[bot]' }, head: { ref: 'mergify/merge-queue/main/batch-example' } } },
  };
  for (const [id, job] of Object.entries(workflow.jobs)) {
    const runs = job.if === undefined || actionsIf(job.if, github);
    assert(runs, `${id} must validate Mergify draft PRs`);
  }
  const optionalExpression = workflow.jobs.results.steps[0].env.QUEUE_ONLY_OPTIONAL.slice(3, -3);
  assert.equal(actionsIf(optionalExpression, github), false, 'batch gates must reject skipped browser/spec jobs');
  assert.equal(actionsIf(optionalExpression, { ...github, head_ref: 'feature/example' }), true,
    'ordinary PRs retain the lighter CI path');
});

test('only the checks job on main saves the pnpm store, and every job restores the same entry', () => {
  const workflow = parse(read('.github/workflows/ci.yml'));
  const action = parse(read('.github/actions/install-dependencies/action.yml'));
  assert.doesNotMatch(read('.github/workflows/ci.yml'), /actions\/setup-node|pnpm install|cache: ["']?pnpm/,
    'jobs install through the shared action');
  assert.doesNotMatch(JSON.stringify(action), /"cache":/, 'setup-node must not save the store after every job');
  for (const [id, job] of Object.entries(workflow.jobs)) {
    if (id === 'results') continue;
    const install = job.steps.find(step => step.uses === './.github/actions/install-dependencies');
    assert(install, `${id} must install through the shared action`);
    assert.equal(install.with?.['save-cache'], id === 'checks' ? "${{ github.event_name == 'push' }}" : undefined, id);
  }
  const steps = action.runs.steps;
  const restore = steps.find(step => step.uses === 'actions/cache/restore@v6');
  const save = steps.find(step => step.uses === 'actions/cache/save@v6');
  assert(!steps.some(step => step.uses?.startsWith('actions/cache@')), 'a combined cache step would save in every job');
  assert.equal(restore.with.path, save.with.path);
  assert.equal(save.with.key, '${{ steps.restore.outputs.cache-primary-key }}');
  assert.match(restore.with.key, /hashFiles\('pnpm-lock.yaml'\)/);
  assert.equal(save.if, "inputs.save-cache == 'true' && steps.restore.outputs.cache-hit != 'true'");
  // A cached path outside the workspace resolves differently in the Playwright container.
  assert(!/^[/~]|\.\./.test(restore.with.path), 'cache a workspace-relative path');
  assert.match(steps.find(step => step.name === 'Keep the pnpm store in the workspace').run,
    new RegExp(`npm_config_store_dir=\\$GITHUB_WORKSPACE/${restore.with.path}"`));
  assert(read('.gitignore').split('\n').includes(restore.with.path));
  // Both cache steps must see the gzip-only environment of the container, and later steps get zstd back.
  const index = name => steps.findIndex(step => step.name === name);
  assert(index('Use the container\'s cache compression') < steps.indexOf(restore));
  assert(index('Restore zstd for later cache steps') === steps.length - 1);
});

test('remote caching uses short-lived tokens and skips untrusted fork PRs', () => {
  const { jobs } = parse(read('.github/workflows/ci.yml'));
  for (const id of ['checks', 'test', 'browser', 'specs']) {
    assert.deepEqual(jobs[id].permissions, { contents: 'read', 'id-token': 'write' });
    const auth = jobs[id].steps.find(step => step.name === 'Authenticate remote cache');
    assert.equal(auth.uses, 'vercel/setup-turborepo-remote-cache-action@135046f5efcadb17337d9b29b8d5b4035ae64b10');
    assert.equal(auth.with.team, '${{ vars.TURBO_TEAM }}');
    assert.equal(auth.with.audience, 'https://vercel.com/camnc-ci-cache');
    assert.equal(auth.with.policy, '${{ vars.TURBO_POLICY_ID }}');
    const enabled = new Function('github', 'vars', `return (${auth.if});`);
    const event = (event_name, head = 'plainoss/camNC') => ({
      event_name, repository: 'plainoss/camNC', event: { pull_request: { head: { repo: { full_name: head } } } },
    });
    for (const name of ['push', 'pull_request']) {
      assert.equal(enabled(event(name), { TURBO_TEAM: 'cache-team' }), true);
      assert.equal(enabled(event(name), { TURBO_TEAM: '' }), false);
    }
    assert.equal(enabled(event('pull_request', 'contributor/camNC'), { TURBO_TEAM: 'cache-team' }), false);
    assert(jobs[id].steps.some(step => step.uses === 'actions/cache@v6'), 'retain local snapshot warming until remote reuse is verified');
  }
  for (const id of ['results', 'fluidnc-sim']) {
    assert.equal(jobs[id].permissions, undefined, 'non-Turbo jobs must not request identity tokens');
  }
  assert.doesNotMatch(read('.github/workflows/ci.yml'), /secrets\.TURBO_TOKEN|pull_request_target/);
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


test('license validation and distribution builds hash their verifier and canonical application license', () => {
  const plan = JSON.parse(execFileSync(process.execPath, [require.resolve('turbo/bin/turbo'), 'run', 'test:licenses', 'build', '--filter=@wbcnc/camNC', '--dry=json'], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
  for (const name of ['test:licenses', 'build']) {
    const task = plan.tasks.find(task => task.taskId === `@wbcnc/camNC#${name}`);
    const inputs = Object.keys(task.inputs);
    assert(inputs.some(file => file.endsWith('e2e/cad/check-distribution.mjs')), `${name} must hash its verifier`);
    assert(inputs.some(file => /(?:^|\/)LICENSE$/.test(file)), `${name} must hash the root license`);
  }
});


test('package and fast-task input overrides retain the shared timing reporter', () => {
  const plan = JSON.parse(execFileSync(process.execPath, [require.resolve('turbo/bin/turbo'), 'run', 'test', 'test:fast', '--filter=@wbcnc/cam', '--filter=@wbcnc/camNC', '--dry=json'], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
  for (const id of ['@wbcnc/cam#test', '@wbcnc/camNC#test:fast']) {
    const task = plan.tasks.find(task => task.taskId === id);
    assert(Object.keys(task.inputs).some(file => file.endsWith('scripts/test-timings.mjs')), `${id} must hash its timing reporter`);
  }
});

test('all workflows use maintained Node.js 24 action releases', () => {
  // Verified against each action's action.yml; cache subactions share the same release.
  const minimumMajor = {
    'actions/checkout': 7,
    'actions/setup-node': 7,
    'actions/cache': 6,
    'pnpm/action-setup': 6,
    'actions/setup-python': 7,
    'actions/upload-artifact': 7,
    'actions/download-artifact': 8,
  };
  const files = [
    ...readdirSync(new URL('.github/workflows/', root)).filter(file => /\.ya?ml$/.test(file)).map(file => `workflows/${file}`),
    'actions/install-dependencies/action.yml',
  ];
  for (const file of files) {
    const parsed = parse(read(`.github/${file}`));
    const workflow = parsed.jobs ? parsed : { jobs: { [parsed.name]: parsed.runs } };
    assert.doesNotMatch(JSON.stringify(workflow), /ubuntu-latest/,
      `${file}: pin Linux runners to avoid unplanned OS migrations`);
    for (const [id, job] of Object.entries(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        if (!step.uses) continue;
        assert(!step.uses.startsWith('seanmiddleditch/gha-setup-ninja@'),
          `${file} ${id}: use hosted Ninja instead of the Node.js 20 installer`);
        const [action, version] = step.uses.split('@');
        const repository = action.split('/').slice(0, 2).join('/');
        if (!(repository in minimumMajor)) continue;
        const major = /^v(\d+)(?:\.|$)/.exec(version);
        assert(major && Number(major[1]) >= minimumMajor[repository],
          `${file} ${id}: ${step.uses} must use a maintained Node.js 24 release`);
      }
    }
  }
});

test('desktop builds run nightly and on demand, not on every merge, and skip a night with no app change', () => {
  const workflow = parse(read('.github/workflows/desktop.yml'));
  assert.equal(workflow.on.push, undefined);
  assert(workflow.on.schedule?.length && 'workflow_dispatch' in workflow.on);
  const pick = workflow.jobs.platforms.steps.find(step => step.id === 'pick');
  assert.match(pick.run, /releases\/latest/);
  assert.equal(workflow.jobs.build.if, "needs.platforms.outputs.include != '[]'");
});

test('every CI test run reports its results to Mergify, and fork PRs without the key skip the uploads', () => {
  const { jobs } = parse(read('.github/workflows/ci.yml'));
  const testRun = step => /vitest|turbo-shared-cache\.mjs run|test:performance/.test(step.run ?? '') && !/spec:cad/.test(step.run);
  for (const [id, job] of Object.entries(jobs)) {
    for (const [index, step] of job.steps?.entries() ?? []) {
      if (testRun(step)) assert(step.env?.MERGIFY_TOKEN, `${id} ${step.name}: Vitest needs MERGIFY_TOKEN`);
      const junit = /--test-reporter-destination=(test-results\/junit\/[\w.-]+)/.exec(step.env?.NODE_OPTIONS ?? '')?.[1];
      const uploads = job.steps.filter(other => other.uses?.startsWith('mergifyio/gha-mergify-ci@'));
      if (!junit) continue;
      assert(uploads.some(upload => upload.with.report_path.endsWith(junit)), `${id} ${step.name}: no upload of ${junit}`);
      assert(job.steps.slice(0, index).some(other => other.run?.startsWith('mkdir -p') && other.run.endsWith(dirname(junit))),
        `${id} ${step.name}: node --test does not create ${dirname(junit)}`);
    }
    for (const upload of job.steps?.filter(step => step.uses?.startsWith('mergifyio/gha-mergify-ci@')) ?? []) {
      assert.equal(job.env?.HAS_MERGIFY_TOKEN, "${{ secrets.MERGIFY_TOKEN != '' }}", `${id}: uploads need the key guard`);
      assert.match(upload.if, /^\(success\(\) \|\| failure\(\)\) && .*env\.HAS_MERGIFY_TOKEN == 'true' && hashFiles\('/);
      assert(upload.with.job_name && upload.with.test_step_outcome, `${id} ${upload.name}`);
    }
  }
  const configs = ['apps', 'packages'].flatMap(dir =>
    readdirSync(new URL(`${dir}/`, root)).flatMap(pkg => {
      const scripts = existsSync(new URL(`${dir}/${pkg}/package.json`, root)) ? JSON.parse(read(`${dir}/${pkg}/package.json`)).scripts ?? {} : {};
      if (!Object.values(scripts).some(script => /\bvitest\b/.test(script))) return [];
      const files = readdirSync(new URL(`${dir}/${pkg}/`, root)).filter(file => /^vitest\..*config\.ts$/.test(file));
      assert(files.length, `${dir}/${pkg} runs Vitest without a config that adds the Mergify reporter`);
      return files.map(file => `${dir}/${pkg}/${file}`);
    })
  );
  for (const file of configs) {
    // The fast set merges the browser config, so it keeps its reporters.
    // The Workers pool cannot load the reporter's runner setup, so those suites write a JUnit report for an upload step.
    if (!file.endsWith('vitest.fast.config.ts')) assert.match(read(file), /'@mergifyio\/vitest'|outputFile: \{ junit: 'test-results\/junit\/worker\.xml' \}/, file);
  }
});
