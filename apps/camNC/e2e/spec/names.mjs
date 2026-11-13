import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { openPage, startDevServer } from './harness.mjs';

/**
 * Checks that the accessible names a glossary maps its terms to exist in the running app, the way a scenario or a
 * screen reader finds them. The glossary is a Markdown table with `camNC accessible name`, `role` and `where` columns;
 * a name in backticks is exact, `/…/` is a regular expression, and `—` means there is no control to find.
 */

/** Where a row is looked up: steps from the page a scenario starts on (a new design, a sketch open on the Top plane). */
export const CONTEXTS = {
  sketch: [],
  studio: ['closesketch'],
  extrude: ['rect 0,0 60,40', 'key Shift+E'],
  'extrude-add': ['rect 0,0 60,40', 'key Shift+E', 'tab Add'],
  'extrude-remove': ['rect 0,0 60,40', 'key Shift+E', 'tab Remove'],
  'part-menu': ['rect 0,0 60,40', 'key Shift+E', 'dialogconfirm', 'partmenu'],
};

const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());

/** The rows of the first table with the three columns, as `{ term, name, role, where }`; `name` is null for `—`. */
export function parseGlossary(text) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith('|') || !/^\|?\s*:?-{3,}/.test(lines[i + 1].trim())) continue;
    const header = cells(lines[i]).map(cell => cell.toLowerCase());
    const column = name => header.indexOf(name);
    const [nameAt, roleAt, whereAt] = ['camnc accessible name', 'role', 'where'].map(column);
    if (nameAt < 0 || roleAt < 0 || whereAt < 0) continue;
    const rows = [];
    for (const line of lines.slice(i + 2)) {
      if (!line.trim().startsWith('|')) break;
      const row = cells(line);
      rows.push({ term: row[0], name: parseName(row[nameAt]), role: row[roleAt], where: row[whereAt] });
    }
    return rows;
  }
  throw new Error('No table with "camNC accessible name", "role" and "where" columns');
}

/** `exact` or a regular expression from a cell: the first backtick span or `/…/`, else null for no control. */
export function parseName(cell) {
  const exact = /`([^`]+)`/.exec(cell ?? '');
  if (exact) return { exact: exact[1] };
  const pattern = /^\/(.+)\/([a-z]*)$/.exec((cell ?? '').trim());
  if (pattern) return { pattern: pattern[1], flags: pattern[2] };
  return null;
}

async function find(page, { name, role }) {
  const accessible = name.exact ?? new RegExp(name.pattern, name.flags);
  const options = { name: accessible, exact: name.exact !== undefined };
  if (await page.getByRole(role, options).count()) return 'found';
  // A Part Studio command that doesn't fit the toolbar's width is in its More menu.
  const more = page.getByRole('group', { name: 'Part Studio features', exact: true }).getByRole('button', { name: 'More', exact: true });
  if (role === 'button' && (await more.count())) {
    await more.click();
    const inMenu = await page.getByRole('menu').getByRole('menuitem', options).count();
    await page.keyboard.press('Escape');
    if (inMenu) return 'found in More menu';
  }
  return null;
}

async function setUp(adapter, page, step) {
  if (step.startsWith('tab ')) await page.getByRole('dialog').getByRole('tab', { name: step.slice(4), exact: true }).click();
  else if (step === 'partmenu') await page.getByRole('list', { name: 'Parts', exact: true }).getByRole('listitem').first().getByRole('button').first().click({ button: 'right' });
  else await adapter.step(step);
  await adapter.settle();
}

export async function checkNames(rows, { url, headed = false } = {}) {
  let server = null;
  if (!url) {
    server = await startDevServer();
    url = server.url;
  }
  const browser = await createRequire(import.meta.url)('playwright').chromium.launch({ headless: !headed });
  const results = [];
  try {
    for (const where of [...new Set(rows.map(row => row.where))]) {
      const wanted = rows.filter(row => row.where === where);
      const steps = CONTEXTS[where];
      if (!steps) {
        results.push(...wanted.map(row => ({ ...row, found: false, error: `unknown where "${where}"; use one of ${Object.keys(CONTEXTS).join(', ')}` })));
        continue;
      }
      const { context, page } = await openPage(browser);
      const done = new Set();
      try {
        const { createAdapter } = await import('./adapters/studio.mjs');
        const adapter = await createAdapter(page, url);
        for (const step of steps) await setUp(adapter, page, step);
        for (const row of wanted) {
          done.add(row);
          if (!row.name) results.push({ ...row, found: null, note: 'no control to find' });
          else {
            const found = await find(page, row);
            results.push({ ...row, found: !!found, ...(found && found !== 'found' && { note: found }) });
          }
        }
      } catch (error) {
        results.push(...wanted.filter(row => !done.has(row)).map(row => ({ ...row, found: false, error: `setting up "${where}" failed: ${String(error.message).split('\n')[0]}` })));
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server?.stop();
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter(arg => arg !== '--');
  const options = {};
  const files = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url') options.url = args[++i];
    else if (args[i] === '--headed') options.headed = true;
    else files.push(args[i]);
  }
  if (files.length !== 1) {
    console.error('Usage: spec:names <glossary.md> [--url <dev server>] [--headed]');
    process.exit(2);
  }
  const rows = parseGlossary(await readFile(path.resolve(process.env.INIT_CWD ?? process.cwd(), files[0]), 'utf8'));
  const results = await checkNames(rows, options);
  for (const result of results) console.log(JSON.stringify(result));
  const missing = results.filter(result => result.found === false);
  console.log(JSON.stringify({ rows: results.length, found: results.filter(result => result.found).length, missing: missing.length }));
  process.exitCode = missing.length ? 1 : 0;
}
