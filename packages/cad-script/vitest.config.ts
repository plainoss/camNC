import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import TimingReporter from '../../scripts/test-timings.mjs';

export default defineConfig({
  resolve: { alias: { '@wbcnc/cad-script': fileURLToPath(new URL('./src/index.ts', import.meta.url)) } },
  test: { environment: 'node', maxWorkers: 2, reporters: ['default', new TimingReporter({ suite: 'cad-script' })] },
});
