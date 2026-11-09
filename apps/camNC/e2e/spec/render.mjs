import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NAMED_VIEWS } from './adapters/sketch.mjs';
import { assertLocalUrl, browserSession } from './session.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));

/** `pnpm --filter` runs in the package, so a relative path is first read from where the command was typed. */
// eslint-disable-next-line turbo/no-undeclared-env-vars -- pnpm's own record of where it was run, not a build input.
const fromCaller = file => path.resolve(process.env.INIT_CWD ?? process.cwd(), file);

export function parseRenderArgs(args) {
  const options = {
    design: null,
    views: [],
    outDir: null,
    viewport: { width: 1440, height: 1000 },
    url: null,
    headed: false,
    planes: false,
  };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--') continue;
    if (flag === '--view') options.views.push(...args[++i].split(','));
    else if (flag === '--out') options.outDir = fromCaller(args[++i]);
    else if (flag === '--url') options.url = args[++i];
    else if (flag === '--headed') options.headed = true;
    else if (flag === '--planes') options.planes = true;
    else if (flag === '--size') {
      const match = /^(\d+)x(\d+)$/.exec(args[++i] ?? '');
      if (!match) throw new Error('--size takes WIDTHxHEIGHT, such as 1440x1000');
      options.viewport = { width: Number(match[1]), height: Number(match[2]) };
    } else if (flag.startsWith('--')) throw new Error(`Unknown option: ${flag}`);
    else if (options.design) throw new Error(`Only one design at a time: ${flag}`);
    else options.design = flag;
  }
  if (!options.design)
    throw new Error(
      'Usage: render <design.json> [--view top|front|right|iso ...] [--out dir] [--size WxH] [--planes] [--url <dev server>]'
    );
  // Relative to where it was typed, else to the package or the spec folder, as `open` reads it.
  const candidates = [fromCaller(options.design), path.resolve(options.design), path.resolve(root, options.design)];
  const design = candidates.find(file => existsSync(file));
  if (!design) throw new Error(`No such design file: ${options.design}`);
  options.design = design;
  if (!options.views.length) options.views = ['iso'];
  for (const view of options.views)
    if (!NAMED_VIEWS.includes(view)) throw new Error(`Unknown view: ${view}. Use one of ${NAMED_VIEWS.join(', ')}`);
  options.outDir ??= path.resolve(root, '../../test-results/spec-render', path.basename(design, '.json'));
  if (options.url) assertLocalUrl(options.url);
  return options;
}

/**
 * Opens the design as a new project, the way a person opens a saved file, and writes one PNG per named view. As in the
 * behaviour specs, a page error or console error fails the render, though its pictures are still written and listed.
 */
export async function renderIn(session, options) {
  const started = Date.now();
  // Unless asked for, the origin and base planes are hidden, so each view frames the parts alone.
  const lines = [`open ${options.design}`, ...(options.planes ? [] : ['hideplanes']), `render ${options.views.join(' ')}`];
  const errors = [];
  let result;
  for (const line of lines) {
    result = await session.run(line);
    errors.push(...(result.errors ?? []));
    if (!result.ok) return { ok: false, error: result.error, errors, ms: Date.now() - started };
  }
  return {
    ok: !errors.length,
    ...(errors.length && { error: 'The page reported errors while opening or rendering the design' }),
    files: result.files,
    parts: result.parts,
    errors,
    ms: Date.now() - started,
  };
}

export async function render(options) {
  const session = await browserSession(options);
  try {
    return await renderIn(session, options);
  } finally {
    await session.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await render(parseRenderArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result));
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  }
}
