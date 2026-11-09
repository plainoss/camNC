import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { onTestFinished, test } from 'vitest';
import { parseRenderArgs, renderIn } from './render.mjs';
import { parseStepsFile, stepLine } from './renderSteps.mjs';

async function stepsFile(text) {
  const dir = await mkdtemp(path.join(tmpdir(), 'camnc-render-steps-'));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'steps.txt');
  await writeFile(file, text);
  return file;
}

test('a steps file has one step per line, and skips blank lines and comments', () => {
  const text = '# a plate with a slot\n\nrect 10,10 100,60\n  // then dimension it\n  key d  \n{"expect":{"entityCount":4}}\r\nshot after\n';
  assert.deepEqual(parseStepsFile(text), ['rect 10,10 100,60', 'key d', 'expect {"entityCount":4}', 'shot after']);
  assert.throws(() => parseStepsFile('rect 0,0 1,1\nreset\n', 'a.txt'), /Line 2 of a.txt can't be `reset`/);
  assert.throws(() => parseStepsFile('{"expect":', 'a.txt'), /Line 1 of a.txt is not valid JSON/);
  assert.throws(() => parseStepsFile('{"click":1}'), /without "expect"/);
  assert.throws(() => stepLine('  '), /is empty/);
});

test('--steps takes every argument up to the next option, and can be given again', () => {
  const options = parseRenderArgs(['--steps', 'rect 10,10 100,60', 'goto Plan', '--view', 'page', '--steps', 'key Escape']);
  assert.deepEqual(options.steps, ['rect 10,10 100,60', 'goto Plan', 'key Escape']);
  assert.deepEqual(options.views, ['page']);
  assert.equal(options.design, null);
  assert.match(options.outDir, /test-results\/spec-render\/new$/);
  assert.throws(() => parseRenderArgs(['--steps', '--view', 'top']), /one or more steps/);
  assert.throws(() => parseRenderArgs(['--steps', 'quit']), /Step 1 can't be `quit`/);
});

test('a render needs a design or steps; with both, the design opens first', async () => {
  assert.throws(() => parseRenderArgs([]), /Usage: render \[design.json\]/);
  assert.throws(() => parseRenderArgs(['--view', 'top']), /Usage/);
  const file = await stepsFile('# from the file\nkey d\n');
  const options = parseRenderArgs(['designs/plate.json', '--steps-file', file, '--steps', 'key Escape']);
  assert.match(options.design, /designs\/plate\.json$/);
  assert.deepEqual(options.steps, ['key d', 'key Escape']);
  assert.match(options.outDir, /spec-render\/plate$/);
  assert.throws(() => parseRenderArgs(['--steps-file', '/no/such/steps.txt']), /No such steps file/);
  assert.throws(() => parseRenderArgs(['--steps-file']), /No such steps file/);
  assert.throws(() => parseRenderArgs(['--steps', 'key d', '--view', 'sideways']), /Unknown view.*page/);
});

/** A session that answers each line as given, recording what it was sent and the screenshots taken. */
const fakeSession = (answer = () => ({})) => {
  const sent = [];
  const shots = [];
  return {
    sent,
    shots,
    run: async line => (sent.push(line), { ok: true, ...answer(line) }),
    screenshot: async name => (shots.push(name), `/out/${name}.png`),
  };
};

test('steps run after the design opens and before the planes are hidden and the views render', async () => {
  const session = fakeSession(line => (line.startsWith('render') ? { files: ['/out/top.png'], parts: 1 } : {}));
  const result = await renderIn(session, { design: '/d/plate.json', steps: ['key d', 'key Escape'], views: ['top'], planes: false });
  assert.deepEqual(session.sent, ['open /d/plate.json', 'key d', 'key Escape', 'hideplanes', 'render top']);
  assert.deepEqual([result.ok, result.files, result.parts], [true, ['/out/top.png'], 1]);
  // Without a design the steps start on the new one, and a picture of only the page leaves the planes alone.
  const bare = fakeSession(() => ({ files: [], parts: 0 }));
  await renderIn(bare, { design: null, steps: ['rect 10,10 100,60', 'goto Plan'], views: ['page'], planes: false });
  assert.deepEqual(bare.sent, ['rect 10,10 100,60', 'goto Plan', 'render page']);
});

test('a failed step stops the render, names the step and writes a picture of the page it left', async () => {
  const session = fakeSession(line => (line === 'goto Plan' ? { ok: false, error: 'no \u001b[2mPlan\u001b[22m link', errors: ['page error: x'] } : {}));
  const result = await renderIn(session, { design: null, steps: ['rect 10,10 100,60', 'goto Plan', 'key d'], views: ['iso'], planes: false });
  assert.deepEqual(session.sent, ['rect 10,10 100,60', 'goto Plan']);
  assert.deepEqual(session.shots, ['failed-step-2']);
  assert.equal(result.ok, false);
  assert.deepEqual([result.step, result.text, result.error, result.file], [2, 'goto Plan', 'no Plan link', '/out/failed-step-2.png']);
  assert.deepEqual(result.errors, ['page error: x']);
  // A failed expectation says what failed.
  const expecting = fakeSession(line => (line.startsWith('expect') ? { ok: false, failures: ['entityCount: 3, wanted 4'] } : {}));
  const failed = await renderIn(expecting, { design: null, steps: ['expect {"entityCount":4}'], views: ['iso'], planes: true });
  assert.deepEqual([failed.step, failed.error], [1, 'Expectation failed: entityCount: 3, wanted 4']);
  assert.deepEqual(failed.failures, ['entityCount: 3, wanted 4']);
});
