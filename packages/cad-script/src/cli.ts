import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { parseCadDocument } from '@wbcnc/cad';
import { editCad, type CadScript } from './edit';
import { renderCadSvg } from './render';
import { inspectCadDocument } from './inspect';
import { typeErrors } from './typecheck';

function parseArgs(args: string[]) {
  const options: { file?: string; from?: string; out?: string; svg?: string } = {};
  const cwd = process.env.INIT_CWD ?? process.cwd();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (flag === '--') continue;
    if (flag === '--from') options.from = path.resolve(cwd, args[++i]!);
    else if (flag === '--out') options.out = path.resolve(cwd, args[++i]!);
    else if (flag === '--svg') options.svg = path.resolve(cwd, args[++i]!);
    else if (flag.startsWith('--')) throw new Error(`Unknown option: ${flag}`);
    else options.file = path.resolve(cwd, flag);
  }
  if (!options.file && !options.from)
    throw new Error('Usage: check [design.cad.ts] [--from document.json] [--out document.json] [--svg drawing.svg]');
  return options;
}

const options = parseArgs(process.argv.slice(2));
const start = options.from ? parseCadDocument(JSON.parse(await readFile(options.from, 'utf8'))) : null;
const finish = async (ok: boolean, output: object, document?: unknown, svg?: string) => {
  console.log(JSON.stringify(output, null, 1));
  // A design that doesn't check out is never written where it could be imported by mistake.
  if (ok && options.out) await writeFile(options.out, `${JSON.stringify(document, null, 1)}\n`);
  if (svg && options.svg) await writeFile(options.svg, svg);
  process.exitCode = ok ? 0 : 1;
};

if (options.file) {
  const types = typeErrors(options.file);
  if (types.length) await finish(false, { ok: false, typeErrors: types });
  else {
    const script = (await import(/* @vite-ignore */ pathToFileURL(options.file).href)).default as CadScript;
    if (typeof script !== 'function') throw new Error('A design file must export default design(d => { ... }).');
    const result = await editCad(start, script, { name: path.basename(options.file).replace(/\.cad\.ts$|\.ts$/, '') });
    const scriptError = result.scriptError && { scriptError: result.scriptError };
    await finish(result.ok, { ...scriptError, ...result.report, ok: result.ok }, result.document, renderCadSvg(result.parts));
  }
} else {
  const { document, report, parts } = await inspectCadDocument(start!);
  await finish(report.ok, report, document, renderCadSvg(parts));
}
