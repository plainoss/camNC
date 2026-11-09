#!/usr/bin/env node
// Caps the length of source files under apps/ and packages/. A file may have at most `limit` lines, unless it is listed
// in file-size-ceilings.json, which records the files that were already longer when the cap arrived. A listed file may
// shrink but never grow, and `--update` lowers its ceiling to match. Nothing here raises a ceiling or adds an entry: a
// file that outgrows its cap is split into new modules instead.
//
//   node scripts/file-size-ratchet.mjs [files...]           check the given files, or every source file when none given
//   node scripts/file-size-ratchet.mjs --staged [files...]  check the content staged in the git index (pre-commit hook)
//   node scripts/file-size-ratchet.mjs --update             lower ceilings of files that shrank, drop entries that fit
//
// The pre-commit hook passes `--staged`, so the check reads each file's staged content with `git show :<path>`, which
// ignores unstaged edits. nano-staged runs the hook's Biome entry concurrently and stages its output only after every
// entry finishes, so for the files that entry formats, the check formats the staged content the same way first (same
// biome.json, same ignores) and counts what the commit will actually contain.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONFIG_FILE = 'scripts/file-size-ceilings.json';
export const DEFAULT_LIMIT = 1000;
// Files the hook's `biome format --write` entry rewrites before they are committed. Keep in sync with package.json.
export const FORMATTED_AT_COMMIT = /\.(ts|tsx)$/;

const SOURCE = /\.(ts|tsx|mjs|js)$/;
const ROOTS = ['apps/', 'packages/'];
// Generated code, tests and test data are not hand-maintained modules.
const BUILT_IN_EXCLUDES = [
  '**/node_modules/**',
  '**/dist/**',
  '**/*.gen.ts',
  '**/*.test.*',
  '**/test_data/**',
  '**/testdata/**',
  '**/fixtures/**',
];

/** Converts a glob with `*` and `**` into a regex over repo-relative paths. */
export function globToRegex(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') {
        i++;
        out += '(?:.*/)?';
      } else out += '.*';
    } else if (c === '*') out += '[^/]*';
    else out += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

/** Whether a repo-relative path is a source file the ratchet covers. */
export function isCovered(path, config = {}) {
  if (!SOURCE.test(path) || !ROOTS.some(root => path.startsWith(root))) return false;
  return ![...BUILT_IN_EXCLUDES, ...(config.exclude ?? [])].some(glob => globToRegex(glob).test(path));
}

export function countLines(text) {
  if (text.length === 0) return 0;
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

const splitHint = 'Move code out into a new module instead of growing this file.';

/**
 * Checks file sizes against the limit and ceilings.
 * @param {Map<string, number>} sizes line counts by repo-relative path
 * @returns {string[]} one message per violation
 */
export function check(sizes, config) {
  const limit = config.limit ?? DEFAULT_LIMIT;
  const ceilings = config.ceilings ?? {};
  const errors = [];
  for (const [path, lines] of sizes) {
    const ceiling = ceilings[path];
    if (ceiling !== undefined) {
      if (lines > ceiling)
        errors.push(
          `${path} has ${lines} lines, above its ceiling of ${ceiling} (files listed in ${CONFIG_FILE} may only shrink). ${splitHint}`
        );
    } else if (lines > limit) {
      errors.push(`${path} has ${lines} lines, above the limit of ${limit}. ${splitHint}`);
    }
  }
  return errors;
}

/**
 * Lowers ceilings for files that shrank, removes entries that fit the limit or no longer exist. Never raises a ceiling
 * or adds an entry; those cases come back as errors.
 * @param {Map<string, number>} sizes line counts of every covered file, by repo-relative path
 * @returns {{ config: object, errors: string[], changes: string[] }}
 */
export function update(sizes, config) {
  const limit = config.limit ?? DEFAULT_LIMIT;
  const ceilings = {};
  const changes = [];
  for (const [path, ceiling] of Object.entries(config.ceilings ?? {})) {
    const lines = sizes.get(path);
    if (lines === undefined) changes.push(`${path}: removed (file no longer exists)`);
    else if (lines <= limit) changes.push(`${path}: removed (${lines} lines fit the limit of ${limit})`);
    else if (lines < ceiling) {
      ceilings[path] = lines;
      changes.push(`${path}: ceiling lowered from ${ceiling} to ${lines}`);
    } else ceilings[path] = ceiling;
  }
  const errors = check(sizes, { ...config, ceilings: config.ceilings ?? {} }).map(
    error => `${error} --update never raises a ceiling or adds a new entry.`
  );
  return { config: { ...config, ceilings }, errors, changes };
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

/** Every covered file in the tree: tracked files plus untracked ones git does not ignore. */
export function listFiles(root, config) {
  return git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...ROOTS])
    .split('\0')
    .filter(path => path && isCovered(path, config) && existsSync(resolve(root, path)));
}

export function loadConfig(root) {
  return JSON.parse(readFileSync(resolve(root, CONFIG_FILE), 'utf8'));
}

export function saveConfig(root, config) {
  const ceilings = Object.fromEntries(Object.entries(config.ceilings).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(resolve(root, CONFIG_FILE), `${JSON.stringify({ ...config, ceilings }, null, 2)}\n`);
}

/** Formats text as the hook's Biome entry would format the file at `path`, unless Biome ignores or can't parse it. */
export async function formatLikeHook(root, path, text) {
  if (!FORMATTED_AT_COMMIT.test(path)) return text;
  const biome = createRequire(import.meta.url).resolve('@biomejs/biome/bin/biome');
  try {
    // An ignored file comes back unchanged.
    return execFileSync(process.execPath, [biome, 'format', `--stdin-file-path=${path}`], { cwd: root, input: text, encoding: 'utf8', stdio: 'pipe' });
  } catch {
    return text; // Biome fails the commit on its own for a syntax error.
  }
}

/** Runs the CLI. Resolves to the exit code. */
export async function main(args, { root = resolve(fileURLToPath(import.meta.url), '../..'), cwd = process.cwd() } = {}) {
  const staged = args.includes('--staged');
  const updating = args.includes('--update');
  const unknown = args.find(arg => arg.startsWith('--') && arg !== '--staged' && arg !== '--update');
  if (unknown) {
    console.error(`Unknown option ${unknown}`);
    return 2;
  }
  const config = loadConfig(root);
  const given = args
    .filter(arg => !arg.startsWith('--'))
    .map(arg => relative(root, isAbsolute(arg) ? arg : resolve(cwd, arg)).replace(/\\/g, '/'));
  const paths = given.length && !updating ? given.filter(path => isCovered(path, config)) : listFiles(root, config);

  const sizes = new Map();
  for (const path of paths) {
    let text;
    if (staged) {
      try {
        text = await formatLikeHook(root, path, git(root, ['show', `:${path}`]));
      } catch {
        continue; // Not in the index, e.g. deleted.
      }
    } else if (existsSync(resolve(root, path))) text = readFileSync(resolve(root, path), 'utf8');
    else continue;
    sizes.set(path, countLines(text));
  }

  if (updating) {
    const result = update(sizes, config);
    if (result.changes.length) {
      saveConfig(root, result.config);
      for (const change of result.changes) console.log(change);
    } else console.log(`${CONFIG_FILE} is up to date.`);
    for (const error of result.errors) console.error(`file-size-ratchet: ${error}`);
    return result.errors.length ? 1 : 0;
  }

  const errors = check(sizes, config);
  for (const error of errors) console.error(`file-size-ratchet: ${error}`);
  return errors.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
