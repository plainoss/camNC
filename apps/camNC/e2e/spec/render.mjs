import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { NAMED_VIEWS } from './adapters/sketch.mjs';
import { parseStepsFile, stepLine } from './renderSteps.mjs';
import { assertLocalUrl, browserSession } from './session.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));

/** `pnpm --filter` runs in the package, so a relative path is first read from where the command was typed. */
// eslint-disable-next-line turbo/no-undeclared-env-vars -- pnpm's own record of where it was run, not a build input.
const fromCaller = file => path.resolve(process.env.INIT_CWD ?? process.cwd(), file);

/** Relative to where it was typed, else to the package or the spec folder, as `open` reads it. */
const findFile = file => [fromCaller(file), path.resolve(file), path.resolve(root, file)].find(candidate => existsSync(candidate));

/** The Part Studio's named views, and `page`: the page as the steps left it, such as the Plan stage. */
export const RENDER_VIEWS = [...NAMED_VIEWS, 'page'];

const USAGE =
  'Usage: render [design.json] [--steps <step> ...] [--steps-file <file>] [--view top|front|right|iso|page ...] [--out dir] [--size WxH] [--planes] [--url <dev server>]';

export function parseRenderArgs(args) {
  const options = {
    design: null,
    steps: [],
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
    else if (flag === '--steps') {
      // Every argument up to the next option is one step, and `--steps` can be given again.
      const start = i;
      while (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        i++;
        const step = stepLine(args[i], `Step ${options.steps.length + 1}`);
        if (step !== null) options.steps.push(step);
      }
      if (i === start) throw new Error('--steps takes one or more steps, such as --steps "rect 10,10 100,60" "key d"');
    } else if (flag === '--steps-file') {
      const name = args[++i];
      const file = name && findFile(name);
      if (!file) throw new Error(`No such steps file: ${name ?? '(none given)'}`);
      options.steps.push(...parseStepsFile(readFileSync(file, 'utf8'), name));
    }
    else if (flag === '--out') options.outDir = fromCaller(args[++i]);
    else if (flag === '--url') options.url = args[++i];
    else if (flag === '--headed') options.headed = true;
    else if (flag === '--domain') options.domain = args[++i];
    else if (flag === '--planes') options.planes = true;
    else if (flag === '--size') {
      const match = /^(\d+)x(\d+)$/.exec(args[++i] ?? '');
      if (!match) throw new Error('--size takes WIDTHxHEIGHT, such as 1440x1000');
      options.viewport = { width: Number(match[1]), height: Number(match[2]) };
    } else if (flag.startsWith('--')) throw new Error(`Unknown option: ${flag}`);
    else if (options.design) throw new Error(`Only one design at a time: ${flag}`);
    else options.design = flag;
  }
  // Without a design, the steps start where a scenario does: a new design with a sketch open on the top plane.
  if (!options.design && !options.steps.length) throw new Error(USAGE);
  if (options.design) {
    const design = findFile(options.design);
    if (!design) throw new Error(`No such design file: ${options.design}`);
    options.design = design;
  }
  if (!options.views.length) options.views = ['iso'];
  for (const view of options.views)
    if (!RENDER_VIEWS.includes(view)) throw new Error(`Unknown view: ${view}. Use one of ${RENDER_VIEWS.join(', ')}`);
  const name = options.design ? path.basename(options.design, '.json') : 'new';
  options.outDir ??= path.resolve(root, '../../test-results/spec-render', name);
  if (options.url) assertLocalUrl(options.url);
  return options;
}

/**
 * Opens the design as a new project, the way a person opens a saved file, runs the steps in order and writes one PNG
 * per view. As in the behaviour specs, a page error or console error fails the render, though its pictures are still
 * written and listed. A failed step stops the render, naming the step, with a screenshot of the page it left.
 */
export async function renderIn(session, options) {
  const started = Date.now();
  const steps = options.steps ?? [];
  // Unless asked for, the origin and base planes are hidden once the steps are done, so each view frames the parts
  // alone. A render of only `page` leaves the page as the steps left it.
  const hide = !options.planes && options.views.some(view => view !== 'page');
  const lines = [
    ...(options.design ? [{ line: `open ${options.design}` }] : []),
    ...steps.map((line, index) => ({ line, step: index + 1 })),
    ...(hide ? [{ line: 'hideplanes' }] : []),
    { line: `render ${options.views.join(' ')}` },
  ];
  const errors = [];
  let result;
  for (const { line, step } of lines) {
    result = await session.run(line);
    errors.push(...(result.errors ?? []));
    if (result.ok) continue;
    const failed = { ok: false };
    if (step) {
      Object.assign(failed, { step, text: line });
      const file = await session.screenshot?.(`failed-step-${step}`).catch(() => null);
      if (file) failed.file = file;
    }
    // Playwright colours its call log for a terminal; this is one JSON line.
    const error = result.error && stripVTControlCharacters(result.error);
    failed.error = error ?? (result.failures?.length ? `Expectation failed: ${result.failures.join('; ')}` : 'failed');
    return { ...failed, ...(result.failures && { failures: result.failures }), errors, ms: Date.now() - started };
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
