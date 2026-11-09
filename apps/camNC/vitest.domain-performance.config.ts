import { defineConfig } from 'vitest/config';
import TimingReporter from '../../scripts/test-timings.mjs';
import config from './vitest.node.config';

export default defineConfig({
  ...config,
  test: {
    ...config.test,
    include: ['src/cam/boards.test.ts'],
    testNamePattern: /\[performance\]/,
    fileParallelism: false,
    reporters: ['default', new TimingReporter({ suite: 'domain-performance' }), '@mergifyio/vitest'],
  },
});
