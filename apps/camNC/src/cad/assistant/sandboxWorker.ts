import { initializeCadSolver, parseCadDocument } from '@wbcnc/cad';
import { cupboard } from '../../../../../packages/cad-script/src/cupboard';
import { editCad, type CadScript } from '../../../../../packages/cad-script/src/edit';

async function scriptFrom(source: string): Promise<CadScript> {
  if (typeof source !== 'string' || source.length > 256_000) throw new Error('A script must be JavaScript text of at most 256 KB.');
  const expression = source
    .replace(/^\s*import\s*\{([^}]+)\}\s*from\s*['"]@wbcnc\/cad-script['"];?\s*/, (_line, names: string) => {
      if (names.split(',').some(name => !['design', 'cupboard'].includes(name.trim())))
        throw new Error('Only design and cupboard may be imported in a browser script.');
      return '';
    })
    .replace(/^\s*export\s*\{\s*cupboard\s*\}\s*from\s*['"]@wbcnc\/cad-script['"];?\s*/m, '')
    .replace(/^\s*export\s+default\s+/m, '')
    .replace(/;\s*$/, '');
  // Native module parsing keeps string evaluation disabled by CSP. This module still runs only inside the disposable
  // opaque worker; importing it never grants application storage, network access, provider keys or an Apply capability.
  const url = URL.createObjectURL(new Blob([`export default (design, cupboard) => (\n${expression}\n);`], { type: 'text/javascript' }));
  try {
    const loaded = await import(/* @vite-ignore */ url);
    const script = loaded.default((fn: CadScript) => fn, cupboard) as unknown;
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
    const result = await editCad(start, d => {
      const returned = script(d) as unknown;
      if (returned && typeof returned === 'object' && 'then' in returned) throw new Error('Design scripts must finish synchronously.');
    });
    reply(result);
  } catch (error) {
    reply({ failure: error instanceof Error ? error.message : 'The script checker stopped.' });
  } finally {
    port.close();
  }
});
