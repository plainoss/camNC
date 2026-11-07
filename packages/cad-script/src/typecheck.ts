import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/** Catches API misuse before anything runs, with the line it's on. Only the design file's own errors are reported. */
export function typeErrors(file: string): string[] {
  const index = fileURLToPath(new URL('./index.ts', import.meta.url));
  const program = ts.createProgram([file], {
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: [],
    baseUrl: path.dirname(index),
    paths: { '@wbcnc/cad-script': [index] },
  });
  const source = program.getSourceFile(file);
  if (!source) return [`Can't read ${file}`];
  return [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)].map(d => {
    const line = d.start === undefined ? 0 : source.getLineAndCharacterOfPosition(d.start).line + 1;
    return `line ${line}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
  });
}
