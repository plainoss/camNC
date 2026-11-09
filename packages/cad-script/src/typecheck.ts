import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tsc = path.join(path.dirname(createRequire(import.meta.url).resolve('typescript/package.json')), 'bin/tsc');

/** Catches API misuse before anything runs, with the line it's on. Only the design file's own errors are reported. */
export function typeErrors(file: string): string[] {
  const index = fileURLToPath(new URL('./index.ts', import.meta.url));
  const target = path.resolve(file);
  // TypeScript 7 has no in-process compiler API yet, so this runs its tsc on a throwaway project holding just the file.
  const dir = mkdtempSync(path.join(tmpdir(), 'cad-script-typecheck-'));
  try {
    const project = path.join(dir, 'tsconfig.json');
    writeFileSync(
      project,
      JSON.stringify({
        compilerOptions: {
          noEmit: true,
          strict: true,
          skipLibCheck: true,
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          types: [],
          paths: { '@wbcnc/cad-script': [index] },
        },
        files: [target],
      })
    );
    let output: string;
    try {
      output = execFileSync(process.execPath, [tsc, '-p', project, '--pretty', 'false'], { encoding: 'utf8', stdio: 'pipe' });
    } catch (error) {
      // tsc exits non-zero when it reports errors; they are on stdout.
      output = String((error as { stdout?: string }).stdout ?? '');
    }
    return parseDiagnostics(output, target);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Turns `file(line,col): error TS1234: message` lines (with indented continuation lines) into `line N: message` for one file. */
export function parseDiagnostics(output: string, file: string): string[] {
  const errors: { file: string; text: string }[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^(.+?)\((\d+),\d+\): error TS\d+: (.*)$/.exec(line);
    if (match) errors.push({ file: path.resolve(match[1]!), text: `line ${match[2]}: ${match[3]}` });
    else if (/^\s+\S/.test(line) && errors.length) errors[errors.length - 1]!.text += ` ${line.trim()}`;
  }
  return errors.filter(error => error.file === file).map(error => error.text);
}
