import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { check, countLines, isCovered, main, update } from './file-size-ratchet.mjs';

const config = { limit: 10, ceilings: { 'apps/a/src/big.ts': 20 } };

test('a new file over the limit fails and names the file, its size and the limit', () => {
  assert.deepEqual(check(new Map([['apps/a/src/small.ts', 10]]), config), []);
  const [error] = check(new Map([['apps/a/src/new.ts', 11]]), config);
  assert.match(error, /apps\/a\/src\/new\.ts has 11 lines, above the limit of 10/);
  assert.match(error, /new module/);
});

test('a listed file at or below its ceiling passes, above it fails', () => {
  assert.deepEqual(check(new Map([['apps/a/src/big.ts', 20]]), config), []);
  assert.deepEqual(check(new Map([['apps/a/src/big.ts', 15]]), config), []);
  const [error] = check(new Map([['apps/a/src/big.ts', 21]]), config);
  assert.match(error, /big\.ts has 21 lines, above its ceiling of 20/);
});

test('--update lowers ceilings but never raises one or adds an entry', () => {
  const lowered = update(new Map([['apps/a/src/big.ts', 15]]), config);
  assert.deepEqual(lowered.config.ceilings, { 'apps/a/src/big.ts': 15 });
  assert.deepEqual(lowered.errors, []);

  const grown = update(new Map([['apps/a/src/big.ts', 25]]), config);
  assert.deepEqual(grown.config.ceilings, { 'apps/a/src/big.ts': 20 });
  assert.match(grown.errors[0], /never raises a ceiling/);

  const added = update(
    new Map([
      ['apps/a/src/big.ts', 20],
      ['apps/a/src/new.ts', 30],
    ]),
    config
  );
  assert.deepEqual(added.config.ceilings, { 'apps/a/src/big.ts': 20 });
  assert.match(added.errors[0], /new\.ts has 30 lines.*new module/);
});

test('--update removes entries that fit the limit or whose file is gone', () => {
  assert.deepEqual(update(new Map([['apps/a/src/big.ts', 10]]), config).config.ceilings, {});
  assert.deepEqual(update(new Map(), config).config.ceilings, {});
});

test('generated files, tests, test data and configured excludes are not covered', () => {
  const excluding = { exclude: ['**/public/**'] };
  assert(isCovered('apps/a/src/x.tsx', excluding));
  assert(isCovered('packages/b/scripts/x.mjs', excluding));
  for (const path of [
    'scripts/x.mjs',
    'apps/a/src/routeTree.gen.ts',
    'apps/a/src/x.test.tsx',
    'apps/a/src/test_data/gcode.tsx',
    'apps/a/node_modules/x/index.js',
    'packages/b/dist/index.js',
    'apps/a/public/vendor.js',
    'apps/a/src/x.css',
  ])
    assert(!isCovered(path, excluding), path);
  assert.equal(countLines(''), 0);
  assert.equal(countLines('a\nb\n'), 2);
  assert.equal(countLines('a\nb'), 2);
});

test('the CLI checks the given files, the staged content, and updates the ceilings file', t => {
  const root = mkdtempSync(join(tmpdir(), 'file-size-ratchet-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, lines) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), 'x\n'.repeat(lines));
  };
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-q');
  write('scripts/file-size-ceilings.json', 0);
  writeFileSync(join(root, 'scripts/file-size-ceilings.json'), JSON.stringify(config));
  write('apps/a/src/big.ts', 20);
  write('apps/a/src/small.ts', 5);
  const run = (...args) => main(args, { root, cwd: root });
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'log', () => {});

  assert.equal(run(), 0);
  write('apps/a/src/big.ts', 21);
  assert.equal(run('apps/a/src/small.ts'), 0, 'only the given files are checked');
  assert.equal(run(join(root, 'apps/a/src/big.ts')), 1);

  git('add', 'apps/a/src/big.ts');
  write('apps/a/src/big.ts', 12);
  assert.equal(run('--staged', 'apps/a/src/big.ts'), 1, 'the staged content is checked, not the working file');
  assert.equal(run('apps/a/src/big.ts'), 0);

  assert.equal(run('--update'), 0);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'scripts/file-size-ceilings.json'), 'utf8')).ceilings, {
    'apps/a/src/big.ts': 12,
  });
});
