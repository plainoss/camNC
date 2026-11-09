import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { onTestFinished, test } from 'vitest';
import { assertLocalUrl, createSession, socketPath } from './session.mjs';

async function fixture(overrides = {}) {
  const outDir = await mkdtemp(path.join(tmpdir(), 'camnc-session-'));
  onTestFinished(() => rm(outDir, { recursive: true, force: true }));
  const log = { steps: [], opened: 0, closed: 0, runtime: [] };
  const adapter = {
    inDemo: async () => true,
    settle: async () => {},
    state: async () => ({ steps: log.steps.length, parts: [{}] }),
    step: async line => {
      if (line === 'bad') throw new Error('Unknown step: bad');
      log.steps.push(line);
    },
    check: async expect => (expect.fail ? ['nope'] : []),
    frame: async () => '<svg/>',
    ...overrides,
  };
  const open = async () => {
    log.opened++;
    const page = { screenshot: ({ path: file }) => writeFile(file, `png after ${log.steps.at(-1)}`) };
    return { adapter, page, runtime: log.runtime, close: async () => void log.closed++ };
  };
  return { log, session: createSession({ open, outDir }), outDir };
}

test('a step keeps the page open and returns the state after it', async () => {
  const { log, session } = await fixture();
  assert.equal((await session.run('rect 0,0 10,10')).state.steps, 1);
  const second = await session.run('  line 0,0 10,10 ');
  assert.equal(second.ok, true);
  assert.equal(second.line, 'line 0,0 10,10');
  assert.equal(second.state.steps, 2);
  assert.equal(log.opened, 1);
});

test('a failed step reports the error and what is on screen, and the session carries on', async () => {
  const { session } = await fixture();
  await session.run('rect 0,0 10,10');
  const failed = await session.run('bad');
  assert.equal(failed.ok, false);
  assert.match(failed.error, /Unknown step/);
  assert.equal(failed.state.steps, 1);
  assert.equal((await session.run('rect 1,1 2,2')).ok, true);
});

test('expect uses the scenario matchers, and a failure fails the line', async () => {
  const { session } = await fixture();
  assert.deepEqual(await session.run('expect {}').then(({ ok, failures }) => ({ ok, failures })), { ok: true, failures: [] });
  assert.deepEqual(await session.run('expect {"fail":true}').then(({ ok, failures }) => ({ ok, failures })), { ok: false, failures: ['nope'] });
  assert.equal((await session.run('expect not json')).ok, false);
});

test('runtime errors are reported once, with the line that caused them', async () => {
  const { log, session } = await fixture();
  log.runtime.push('page error: boom');
  assert.deepEqual((await session.run('rect 0,0 1,1')).errors, ['page error: boom']);
  assert.equal((await session.run('rect 0,0 1,1')).errors, undefined);
});

test('frame writes the normalized drawing, and names cannot leave the output folder', async () => {
  const { session, outDir } = await fixture();
  const { file } = await session.run('frame after-rect');
  assert.equal(file, path.join(outDir, 'after-rect.svg'));
  assert.equal(await readFile(file, 'utf8'), '<svg/>');
  assert.equal((await session.run('frame ../../escape')).ok, false);
});

test('frame says so when there is no canvas', async () => {
  const { session } = await fixture({ frame: async () => null });
  assert.match((await session.run('frame x')).error, /no sketch canvas/);
});

test('render sets each named view and writes a picture of it', async () => {
  const { log, session, outDir } = await fixture();
  const result = await session.run('render top iso');
  assert.deepEqual(log.steps, ['view top', 'view iso']);
  assert.deepEqual(result.files, [path.join(outDir, 'top.png'), path.join(outDir, 'iso.png')]);
  assert.equal(await readFile(result.files[0], 'utf8'), 'png after view top');
  assert.equal(result.parts, 1);
  assert.deepEqual((await session.run('render')).files, [path.join(outDir, 'iso.png')]);
});

test('reset starts over on a fresh page', async () => {
  const { log, session } = await fixture();
  await session.run('rect 0,0 1,1');
  assert.equal((await session.run('reset')).ok, true);
  assert.deepEqual([log.opened, log.closed], [2, 1]);
});

test('nothing is driven once the page has left demo mode', async () => {
  const { log, session } = await fixture({ inDemo: async () => false });
  const result = await session.run('run');
  assert.equal(result.ok, false);
  assert.match(result.error, /left demo mode/);
  assert.deepEqual(log.steps, []);
});

test('a session only targets a local server', () => {
  assert.doesNotThrow(() => assertLocalUrl('http://127.0.0.1:5180'));
  assert.doesNotThrow(() => assertLocalUrl('http://localhost:5180/'));
  assert.throws(() => assertLocalUrl('https://app.example.com'), /local dev server/);
});

test('socket paths differ per checkout and fit the Unix limit', () => {
  const long = `/Users/someone/${'nested/'.repeat(20)}checkout`;
  assert.notEqual(socketPath(long), socketPath(`${long}2`));
  assert.ok(socketPath(long).length < 104);
});
