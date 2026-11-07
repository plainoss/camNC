import TimingReporter from '../../scripts/test-timings.mjs';
import { defineConfig } from 'vitest/config';

// Pure geometry + wasm: runs in Node (and later in a web worker), no browser needed.
export default defineConfig({
  test: {
    reporters: ['default', new TimingReporter({ suite: 'cam' })],
    // Root tests run these CPU-sensitive gates afterwards, without competing suites or packages.
    testNamePattern: /^(?!.*\[performance\]).*$/,
    globals: false,
    environment: 'node',
    setupFiles: ['src/testSetup.ts'],
    // Loading a STEP fixture and extracting features in beforeAll takes > 10 s on a busy CI runner.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
