import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { parseCadDocument, sketchToDxf, sketchToSvg, type CadDocument, type CadLengthUnit, type CadPart } from '@wbcnc/cad';
import { editCad, type CadScript } from './edit';
import { renderCadSvg } from './render';
import { fullCadReport, fullReportText } from './fullReport';
import { inspectCadDocument } from './inspect';
import { compactCadReport } from './compactReport';
import { typeErrors } from './typecheck';
import { renderCadViews } from './views/render';
import { renderCadSection, type CadSectionRequest } from './views/section';
import { reportFlatParts } from './reportGeometry';

function parseArgs(args: string[]) {
  const options: {
    file?: string;
    from?: string;
    out?: string;
    svg?: string;
    full?: boolean;
    views?: string;
    section?: CadSectionRequest;
    exportSketch?: { sketch: string; file: string; unit?: CadLengthUnit; construction: boolean };
  } = {};
  let exportSketch: string | undefined,
    exportFile: string | undefined,
    exportUnit: CadLengthUnit | undefined,
    exportConstruction = false;
  let sectionPart: string | undefined,
    sectionCut: string | undefined,
    sectionAxis: 'x' | 'y' = 'x',
    sectionAt: number | undefined;
  const cwd = process.env.INIT_CWD ?? process.cwd();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (flag === '--') continue;
    if (flag === '--from') options.from = path.resolve(cwd, args[++i]!);
    else if (flag === '--out') options.out = path.resolve(cwd, args[++i]!);
    else if (flag === '--svg') options.svg = path.resolve(cwd, args[++i]!);
    else if (flag === '--views') options.views = path.resolve(cwd, args[++i]!);
    else if (flag === '--export-sketch') exportSketch = args[++i];
    else if (flag === '--export') exportFile = path.resolve(cwd, args[++i]!);
    else if (flag === '--export-construction') exportConstruction = true;
    else if (flag === '--export-unit') {
      const unit = args[++i];
      if (!['mm', 'cm', 'm', 'in', 'ft'].includes(unit!)) throw new Error('--export-unit takes mm, cm, m, in or ft.');
      exportUnit = unit as CadLengthUnit;
    } else if (flag === '--section-part') sectionPart = args[++i];
    else if (flag === '--section-cut') sectionCut = args[++i];
    else if (flag === '--section-at') {
      sectionAt = Number(args[++i]);
      if (!Number.isFinite(sectionAt)) throw new Error('--section-at needs a finite coordinate.');
    } else if (flag === '--section-axis') {
      const axis = args[++i];
      if (axis !== 'x' && axis !== 'y') throw new Error('--section-axis takes x or y.');
      sectionAxis = axis;
    } else if (flag === '--report') {
      const kind = args[++i];
      if (kind !== 'full' && kind !== 'check') throw new Error(`--report takes full or check, not ${kind ?? 'nothing'}.`);
      options.full = kind === 'full';
    } else if (flag.startsWith('--')) throw new Error(`Unknown option: ${flag}`);
    else options.file = path.resolve(cwd, flag);
  }
  if (!options.file && !options.from)
    throw new Error(
      'Usage: check [design.cad.ts] [--from document.json] [--out document.json] [--svg drawing.svg] [--export-sketch name --export drawing.dxf|svg] [--report full]'
    );
  if (exportSketch || exportFile) {
    if (!exportSketch || !exportFile || !/\.(dxf|svg)$/i.test(exportFile))
      throw new Error('A sketch export needs --export-sketch name and --export drawing.dxf or drawing.svg.');
    options.exportSketch = { sketch: exportSketch, file: exportFile, unit: exportUnit, construction: exportConstruction };
  }
  if (sectionPart || sectionCut || sectionAt !== undefined) {
    if (!sectionPart || !sectionCut || !options.views)
      throw new Error('A section needs --views directory, --section-part name and --section-cut handle.');
    options.section = { part: sectionPart, cut: sectionCut, axis: sectionAxis, ...(sectionAt !== undefined && { at: sectionAt }) };
  }
  return options;
}

// The solver logs as it works. Its messages go to stderr, so stdout is the report and nothing else.
const print = console.log.bind(console);
console.log = console.error.bind(console);

const options = parseArgs(process.argv.slice(2));
const start = options.from ? parseCadDocument(JSON.parse(await readFile(options.from, 'utf8'))) : null;
type Inspected = Awaited<ReturnType<typeof inspectCadDocument>> & { scriptError?: string };
/** The part whose sketch is named so: by the sketch's own name or ID first, as the feature list names it, then its part's. */
const sketchPart = (parts: readonly CadPart[], name: string) =>
  parts.find(p => p.sketchName === name || p.sketch.id === name) ?? parts.find(p => p.name === name || p.id === name);
const finish = async (ok: boolean, output: object, document?: unknown, svg?: string, inspected?: Inspected) => {
  // A sketch that isn't there fails the check before anything is written, so --out never outlives a failed run.
  const exportPart =
    ok && options.exportSketch && inspected ? sketchPart(inspected.document.parts, options.exportSketch.sketch) : undefined;
  const exportError = ok && options.exportSketch && !exportPart ? `No sketch named ${options.exportSketch.sketch}.` : undefined;
  if (exportError) {
    ok = false;
    output = { ...output, exportError };
  }
  // A design that doesn't check out is never written where it could be imported by mistake.
  if (ok && options.out) await writeFile(options.out, `${JSON.stringify(document, null, 1)}\n`);
  else if (!ok && options.out) await rm(options.out, { force: true });
  if (svg && options.svg) await writeFile(options.svg, svg);
  else if (!ok && options.svg) await rm(options.svg, { force: true });
  let drawings: Record<string, string> | undefined;
  if (options.exportSketch) {
    await rm(options.exportSketch.file, { force: true });
    if (exportPart) {
      const { file, unit, construction } = options.exportSketch;
      const write = /\.svg$/i.test(file) ? sketchToSvg : sketchToDxf;
      await writeFile(file, write(exportPart.sketch, { unit, construction }));
      drawings = { ...drawings, export: file };
    }
  }

  if (options.views) {
    const files = ['top', 'front', 'right', 'section'].map(name => path.join(options.views!, `${name}.svg`));
    // A rejected revision cannot leave the preceding candidate's views beside its report.
    await Promise.all(files.map(file => rm(file, { force: true })));
    if (ok && inspected) {
      await mkdir(options.views, { recursive: true });
      drawings = { ...drawings };
      for (const view of renderCadViews(inspected.document, inspected.parts, true, inspected.evaluation)) {
        const file = path.join(options.views, `${view.name}.svg`);
        await writeFile(file, view.svg);
        drawings[view.name] = file;
      }
      if (options.section) {
        const section = renderCadSection(inspected.document, inspected.parts, options.section, inspected.evaluation);
        const file = path.join(options.views, 'section.svg');
        await writeFile(file, section.svg);
        drawings.section = file;
      }
    }
  }
  // Printed once the files are written, so a passing report means they're there. The full report is of the design as
  // written, or as it was when the script failed.
  if (options.full && document) {
    const full = await fullCadReport(document as CadDocument, inspected, {
      views: !!options.views && ok,
      ...(ok && options.section && { section: options.section }),
    });
    process.stdout.write(fullReportText(exportError ? { ...full, ok: false, exportError } : full));
  } else
    print(
      JSON.stringify(
        {
          ...(inspected ? { ...output, ...compactCadReport(inspected.document, inspected.report) } : output),
          ...(drawings && { drawings }),
          ok,
        },
        null,
        1
      )
    );
  process.exitCode = ok ? 0 : 1;
};

if (options.file) {
  const types = typeErrors(options.file);
  if (types.length) await finish(false, { ok: false, typeErrors: types });
  else {
    // Loading the file runs its top level, which can throw as well as the design can.
    const run = async () => {
      const script = (await import(/* @vite-ignore */ pathToFileURL(options.file!).href)).default as CadScript;
      if (typeof script !== 'function') throw new Error('A design file must export default design(d => { ... }).');
      return editCad(start, script, { name: path.basename(options.file!).replace(/\.cad\.ts$|\.ts$/, '') });
    };
    const result = await run().catch((error: unknown) => {
      // A bug in the script, not a refusal by the API: the caller still reads JSON, with the line it happened on.
      const where =
        error instanceof Error
          ? error.stack
              ?.split('\n')
              .find(line => line.includes(options.file!))
              ?.trim()
          : undefined;
      return { thrown: `${error instanceof Error ? error.message : String(error)}${where ? ` (${where})` : ''}` };
    });
    if ('thrown' in result) await finish(false, { ok: false, scriptError: `The script threw: ${result.thrown}` });
    else {
      const scriptError = result.scriptError && { scriptError: result.scriptError };
      await finish(
        result.ok,
        { ...scriptError, ...result.report, ok: result.ok },
        result.document,
        renderCadSvg(reportFlatParts(result.document, result.parts, result.evaluation)),
        // A script that stopped leaves the design as it was, which is what the check reported on.
        result
      );
    }
  }
} else {
  const inspected = await inspectCadDocument(start!);
  await finish(
    inspected.report.ok,
    inspected.report,
    inspected.document,
    renderCadSvg(reportFlatParts(inspected.document, inspected.parts, inspected.evaluation)),
    inspected
  );
}
