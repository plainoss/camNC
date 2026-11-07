import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { tryLock } from './test-lock.mjs';

const newLock = () => path.join(mkdtempSync(path.join(tmpdir(), 'test-lock-')), 'full-test.lock');
const deadPid = () => spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }).stdout.trim();

test('the first caller takes the lock and a second waits while the owner lives', () => {
  const file = newLock();
  assert.equal(tryLock(file), true);
  assert.equal(readFileSync(file, 'utf8'), String(process.pid));
  assert.equal(tryLock(file, 12345), false);
});

test('a lock left by a dead process is taken over', () => {
  const file = newLock();
  writeFileSync(file, deadPid());
  assert.equal(tryLock(file), true);
  assert.equal(readFileSync(file, 'utf8'), String(process.pid));
});

test('a lock with no PID yet is held at first and stale after a minute', () => {
  const file = newLock();
  writeFileSync(file, '');
  assert.equal(tryLock(file), false);
  assert.equal(tryLock(file, process.pid, Date.now() + 61_000), true);
});

test('full and fast preflight commands both acquire the shared test lock', () => {
  const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const name of ['test', 'test:fast']) {
    assert(scripts[name].startsWith('node scripts/test-lock.mjs "'));
    assert(scripts[name].endsWith('"'), 'the complete compound command must stay inside the lock');
  }
});

test('broad commands wait for the checkout lock while CI bypasses it', { timeout: 15_000 }, async t => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'test-lock-integration-'));
  execFileSync('git', ['init', '--quiet', cwd]);
  const holding = path.join(cwd, 'holding.mjs');
  writeFileSync(holding, "console.log('holding'); process.stdin.on('end', () => process.exit(0)); process.stdin.resume();");
  const done = path.join(cwd, 'done.mjs');
  writeFileSync(done, "console.log('acquired');");
  const wrapper = fileURLToPath(new URL('./test-lock.mjs', import.meta.url));
  const run = (script, ci = '') => spawn(process.execPath, [wrapper, `"${process.execPath}" "${script}"`], {
    cwd, env: { ...process.env, CI: ci }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const owner = run(holding);
  t.after(() => { owner.stdin.end(); owner.kill(); rmSync(cwd, { recursive: true, force: true }); });
  assert.match(String((await once(owner.stdout, 'data'))[0]), /holding/);
  const waiter = run(done);
  t.after(() => waiter.kill());
  assert.match(String((await once(waiter.stdout, 'data'))[0]), /Another test suite holds/);
  // It still belongs to the first invocation, so the waiting command has not run.
  assert.equal(readFileSync(path.join(cwd, '.git/full-test.lock'), 'utf8'), String(owner.pid));
  const ci = run(done, 'true');
  t.after(() => ci.kill());
  const ciExit = once(ci, 'exit');
  assert.match(String((await once(ci.stdout, 'data'))[0]), /acquired/);
  assert.equal((await ciExit)[0], 0);
  const ownerExit = once(owner, 'exit');
  const waiterExit = once(waiter, 'exit');
  owner.stdin.end();
  assert.equal((await ownerExit)[0], 0);
  assert.equal((await waiterExit)[0], 0);
});
