import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { FORMATTED_AT_COMMIT, check, checkGrowth, countLines, isCovered, main, update } from './file-size-ratchet.mjs';

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

test('the CLI checks the given files, the staged content, and updates the ceilings file', async t => {
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

  assert.equal(await run(), 0);
  write('apps/a/src/big.ts', 21);
  assert.equal(await run('apps/a/src/small.ts'), 0, 'only the given files are checked');
  assert.equal(await run(join(root, 'apps/a/src/big.ts')), 1);

  git('add', 'apps/a/src/big.ts');
  write('apps/a/src/big.ts', 12);
  assert.equal(await run('--staged', 'apps/a/src/big.ts'), 1, 'the staged content is checked, not the working file');
  assert.equal(await run('apps/a/src/big.ts'), 0);

  assert.equal(await run('--update'), 0);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'scripts/file-size-ceilings.json'), 'utf8')).ceilings, {
    'apps/a/src/big.ts': 12,
  });
});

test('--staged counts staged content as the hook will format it, not the raw index', async t => {
  const root = mkdtempSync(join(tmpdir(), 'file-size-ratchet-format-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-q');
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'apps/a/src'), { recursive: true });
  writeFileSync(join(root, 'scripts/file-size-ceilings.json'), JSON.stringify({ limit: 10, ceilings: { 'apps/a/src/listed.ts': 12 } }));
  writeFileSync(join(root, 'biome.json'), JSON.stringify({ files: { includes: ['**', '!apps/a/src/ignored.ts'] }, formatter: { lineWidth: 40 } }));
  // One line that Biome expands to one line per element.
  const oneLiner = `export const xs = [${Array.from({ length: 12 }, (_, i) => `'item${i}'`).join(', ')}];\n`;
  // Twenty-two lines (one number per line) that Biome joins into a few.
  const sprawling = `export const ys = [\n${'  1,\n'.repeat(20)}];\n`;
  for (const [file, text] of [
    ['expanded.ts', oneLiner],
    ['ignored.ts', oneLiner],
    ['plain.mjs', oneLiner],
    ['listed.ts', sprawling],
  ])
    writeFileSync(join(root, 'apps/a/src', file), text);
  git('add', '.');
  t.mock.method(console, 'error', () => {});
  const run = file => main(['--staged', `apps/a/src/${file}`], { root, cwd: root });

  assert.equal(await run('expanded.ts'), 1, 'formatting grows the file past the limit');
  assert.equal(await run('ignored.ts'), 0, 'an ignored file stays as staged');
  assert.equal(await run('plain.mjs'), 0, 'the hook does not format .mjs files');
  assert.equal(await run('listed.ts'), 0, 'formatting shrinks the file below its ceiling');
});

test('the files the ratchet formats are the ones the hook formats with Biome', () => {
  const hook = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))['nano-staged'];
  const [glob] = Object.entries(hook).find(([, command]) => command.startsWith('biome format --write'));
  for (const ext of glob
    .match(/\{(.*)\}/)[1]
    .split(','))
    assert(FORMATTED_AT_COMMIT.test(`x.${ext}`), ext);
  assert(!FORMATTED_AT_COMMIT.test('x.mjs') && !FORMATTED_AT_COMMIT.test('x.js'));
});

test('--base fails a listed file that grew since the base, even below its ceiling', async t => {
  const root = mkdtempSync(join(tmpdir(), 'file-size-ratchet-base-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  const write = (path, lines) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), 'x\n'.repeat(lines));
  };
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  mkdirSync(join(root, 'scripts'));
  writeFileSync(join(root, 'scripts/file-size-ceilings.json'), JSON.stringify({ limit: 10, ceilings: { 'apps/a/src/big.ts': 20 } }));
  write('apps/a/src/big.ts', 15);
  write('apps/a/src/small.ts', 5);
  git('add', '.');
  git('commit', '-qm', 'base');
  const run = (...args) => main(args, { root, cwd: root });
  t.mock.method(console, 'error', () => {});

  write('apps/a/src/big.ts', 16);
  write('apps/a/src/small.ts', 9);
  assert.equal(await run(), 0, 'without --base only the ceiling counts');
  assert.equal(await run('--base', 'HEAD'), 1, 'one line more than at the base fails');
  write('apps/a/src/big.ts', 14);
  assert.equal(await run('--base', 'HEAD'), 0, 'shrinking passes, and unlisted files may grow within the limit');
  write('apps/a/src/new.ts', 3);
  assert.equal(await run('--base', 'HEAD', 'apps/a/src/new.ts'), 0, 'a file the base lacks has not grown');
  assert.equal(await run('--base'), 2);
});

test('checkGrowth only reports listed files that the base has', () => {
  const config = { ceilings: { 'a.ts': 30, 'b.ts': 30 } };
  const sizes = new Map([['a.ts', 12], ['b.ts', 12], ['c.ts', 12]]);
  const errors = checkGrowth(sizes, new Map([['a.ts', 10], ['c.ts', 1]]), config, 'main');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /a\.ts has 12 lines, 2 more than at main/);
});
