import TimingReporter from '../../scripts/test-timings.mjs';
import { defineConfig } from 'vitest/config';
import config from './vitest.config';

export default defineConfig({
  ...config,
  test: {
    ...config.test,
    include: ['src/settle.test.ts', 'src/cutout.test.ts', 'src/pocketIslands.test.ts'],
    testNamePattern: /\[performance\]/,
    fileParallelism: false,
    reporters: ['default', new TimingReporter({ suite: 'cam-performance' }), '@mergifyio/vitest'],
  },
});
