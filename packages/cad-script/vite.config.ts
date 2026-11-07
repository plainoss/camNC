import { fileURLToPath } from 'node:url';

// A design file can live anywhere, so it can't find this package through node_modules.
export default { resolve: { alias: { '@wbcnc/cad-script': fileURLToPath(new URL('./src/index.ts', import.meta.url)) } } };
