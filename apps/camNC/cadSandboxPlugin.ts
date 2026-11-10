import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'vite';

/** A single local bundle: the opaque sandbox cannot import application modules or fetch a WASM asset. */
export function cadSandboxPlugin(): Plugin {
  const id = 'virtual:cad-script-sandbox';
  const resolved = `\0${id}`;
  let bundle: Promise<string> | undefined;
  return {
    name: 'cad-script-sandbox',
    resolveId(source) {
      return source === id ? resolved : undefined;
    },
    async load(source) {
      if (source !== resolved) return;
      bundle ??= (async () => {
        const result = await build({
          configFile: false,
          logLevel: 'error',
          define: { 'process.env.NODE_ENV': JSON.stringify('production') },
          build: {
            write: false,
            minify: true,
            target: 'es2022',
            lib: {
              entry: fileURLToPath(new URL('./src/cad/assistant/sandboxWorker.ts', import.meta.url)),
              name: 'CamncCadSandbox',
              formats: ['iife'],
            },
          },
        });
        const outputs = Array.isArray(result) ? result : [result];
        const code = outputs.flatMap(output => ('output' in output ? output.output : [])).find(output => output.type === 'chunk');
        if (!code || code.type !== 'chunk') throw new Error('The CAD sandbox did not produce a self-contained script.');
        return code.code;
      })();
      return `export default ${JSON.stringify(await bundle)};`;
    },
  };
}
