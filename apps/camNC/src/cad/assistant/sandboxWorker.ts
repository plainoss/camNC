import { initializeCadSolver, parseCadDocument } from '@wbcnc/cad';
import { cupboard } from '../../../../../packages/cad-script/src/cupboard';
import { frameStool } from '../../../../../packages/cad-script/src/frameStool';
import { panelChair } from '../../../../../packages/cad-script/src/panelChair';
import { editCad, type CadScript } from '../../../../../packages/cad-script/src/edit';

/** Whole-piece builders a script may import, in the order the module wrapper passes them. */
const kPatterns = { cupboard, panelChair, frameStool };
/** Lines are kept in place (stripped imports become blank lines), so a stack line maps straight back to the source. */
const keepLines = (match: string) => '\n'.repeat(match.split('\n').length - 1);
let scriptUrl = '';
/** The failing source line from the error's stack frame in the script module, if the error came from there. */
function located(error: unknown, source: string): string {
  const stack = error instanceof Error ? (error.stack ?? '') : '';
  const frame = scriptUrl && stack.split(scriptUrl + ':')[1]?.match(/^(\d+):(\d+)/);
  if (!frame) return '';
  // The module wrapper adds one line before the script.
  const line = Number(frame[1]) - 1;
  const text = source.split('\n')[line - 1]?.trim();
  return text ? ` (script line ${line}: ${text.length > 160 ? `${text.slice(0, 160)}…` : text})` : ` (script line ${line})`;
}

async function scriptFrom(source: string): Promise<CadScript> {
  if (typeof source !== 'string' || source.length > 256_000) throw new Error('A script must be JavaScript text of at most 256 KB.');
  const expression = source
    .replace(/^\s*import\s*\{([^}]+)\}\s*from\s*['"]@wbcnc\/cad-script['"];?\s*/, (_line, names: string) => {
      if (names.split(',').some(name => !['design', ...Object.keys(kPatterns)].includes(name.trim())))
        throw new Error(`Only design, ${Object.keys(kPatterns).join(', ')} may be imported in a browser script.`);
      return keepLines(_line);
    })
    .replace(/^\s*export\s*\{\s*(?:cupboard|panelChair|frameStool)\s*\}\s*from\s*['"]@wbcnc\/cad-script['"];?\s*/m, keepLines)
    .replace(/^\s*export\s+default\s+/m, keepLines)
    .replace(/;\s*$/, '');
  // Native module parsing keeps string evaluation disabled by CSP. This module still runs only inside the disposable
  // opaque worker; importing it never grants application storage, network access, provider keys or an Apply capability.
  const url = URL.createObjectURL(
    new Blob([`export default (design, ${Object.keys(kPatterns).join(', ')}) => (\n${expression}\n);`], { type: 'text/javascript' })
  );
  scriptUrl = url;
  try {
    const loaded = await import(/* @vite-ignore */ url);
    const script = loaded.default((fn: CadScript) => fn, ...Object.values(kPatterns)) as unknown;
    if (typeof script !== 'function') throw new Error('Export default design(d => { ... }) or pass a JavaScript function.');
    return script as CadScript;
  } finally {
    URL.revokeObjectURL(url);
  }
}

self.addEventListener('message', async function run(event: MessageEvent) {
  self.removeEventListener('message', run);
  const port = event.ports[0];
  if (!port) return;
  // Capture the private sender before evaluating code which can change globals in its own disposable worker.
  const reply = port.postMessage.bind(port);
  try {
    const start = parseCadDocument(event.data.document);
    // Opaque origins lack the secure-context randomUUID helper; getRandomValues remains available locally.
    if (!crypto.randomUUID)
      Object.defineProperty(crypto, 'randomUUID', {
        value: () => {
          const bytes = crypto.getRandomValues(new Uint8Array(16));
          bytes[6] = (bytes[6]! & 15) | 64;
          bytes[8] = (bytes[8]! & 63) | 128;
          const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
          return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
        },
      });
    await initializeCadSolver();
    // Defense in depth: CSP denies outbound requests and the opaque origin denies storage even through prototypes.
    for (const name of [
      'fetch',
      'XMLHttpRequest',
      'WebSocket',
      'EventSource',
      'importScripts',
      'Worker',
      'SharedWorker',
      'indexedDB',
      'caches',
      'localStorage',
      'sessionStorage',
    ]) {
      Object.defineProperty(self, name, {
        configurable: false,
        get() {
          throw new Error(`Scripts cannot access ${name}.`);
        },
      });
    }
    const script = await scriptFrom(event.data.source);
    let thrown: unknown;
    const result = await editCad(
      start,
      d => {
        try {
          const returned = script(d) as unknown;
          if (returned && typeof returned === 'object' && 'then' in returned) throw new Error('Design scripts must finish synchronously.');
        } catch (error) {
          thrown = error;
          throw error;
        }
      },
      { toolpaths: event.data.toolpaths !== false }
    );
    if (result.scriptError) result.scriptError += located(thrown, event.data.source);
    reply(result);
  } catch (error) {
    const name = error instanceof Error && error.name !== 'Error' && !error.message.startsWith(error.name) ? `${error.name}: ` : '';
    reply({
      failure: error instanceof Error ? `${name}${error.message}${located(error, event.data.source)}` : 'The script checker stopped.',
    });
  } finally {
    port.close();
  }
});
