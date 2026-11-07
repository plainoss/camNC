import TimingReporter from '../../scripts/test-timings.mjs';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    reporters: ['default', new TimingReporter({ suite: 'cad' })],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
