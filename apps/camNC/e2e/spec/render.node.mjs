// Starts a dev server and a browser, so it runs in CI's behaviour-spec job rather than the unit suites.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { parseRenderArgs } from './render.mjs';

/** Width and height from a PNG's header chunk. */
const pngSize = bytes => {
  assert.equal(bytes.subarray(1, 4).toString('latin1'), 'PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};

test('render options name a design, its views and a picture size', () => {
  const options = parseRenderArgs(['designs/plate.json', '--view', 'top,iso', '--view', 'front', '--size', '800x600', '--out', '/tmp/x']);
  assert.match(options.design, /e2e\/spec\/designs\/plate\.json$/);
  assert.deepEqual(options.views, ['top', 'iso', 'front']);
  assert.deepEqual(options.viewport, { width: 800, height: 600 });
  assert.equal(options.outDir, '/tmp/x');
  assert.deepEqual(parseRenderArgs(['designs/plate.json']).views, ['iso']);
  assert.throws(() => parseRenderArgs(['designs/plate.json', '--view', 'sideways']), /Unknown view/);
  assert.throws(() => parseRenderArgs(['designs/plate.json', '--size', 'big']), /WIDTHxHEIGHT/);
  assert.throws(() => parseRenderArgs(['designs/missing.json']), /No such design/);
  assert.throws(() => parseRenderArgs(['designs/plate.json', '--url', 'https://app.example.com']), /local dev server/);
});

test('a saved design renders to one PNG per view, at the asked size', { timeout: 240_000 }, async t => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'camnc-render-'));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  // As its own process, the way it's used.
  const cli = fileURLToPath(new URL('./render.mjs', import.meta.url));
  const args = [cli, 'designs/plate.json', '--view', 'top', '--size', '1000x700', '--out', outDir];
  const { stdout } = await promisify(execFile)(process.execPath, args, { timeout: 230_000 });
  const result = JSON.parse(stdout.trim().split('\n').at(-1));
  assert.equal(result.ok, true, result.error);
  assert.equal(result.parts, 1);
  assert.deepEqual(result.files, [path.join(outDir, 'top.png')]);
  const bytes = await readFile(result.files[0]);
  assert.ok(bytes.length > 1000);
  assert.deepEqual(pngSize(bytes), { width: 1000, height: 700 });
});
