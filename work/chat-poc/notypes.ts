// Runs a script the way an in-browser check would: no type check first. Prints what the model would be told.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseCadDocument } from '@wbcnc/cad';
import { editCad } from '../../packages/cad-script/src/index';

const [script, from] = process.argv.slice(2).filter(arg => arg !== '--');
const log = console.log.bind(console);
console.log = console.error.bind(console);
const start = from ? parseCadDocument(JSON.parse(readFileSync(from, 'utf8'))) : null;
try {
  const run = (await import(pathToFileURL(script!).href)).default;
  const result = await editCad(start, run);
  log(
    JSON.stringify({
      ok: result.ok,
      scriptError: result.scriptError,
      errors: result.report.errors.map(e => `${e.code}: ${e.message}`).slice(0, 5),
    })
  );
} catch (error) {
  log(JSON.stringify({ ok: false, thrown: error instanceof Error ? error.message : String(error) }));
}
