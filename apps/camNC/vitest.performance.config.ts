import TimingReporter from '../../scripts/test-timings.mjs';
import { defineConfig } from 'vitest/config';
import config from './vitest.config';

export default defineConfig({
  ...config,
  test: {
    ...config.test,
    reporters: ['default', new TimingReporter({ suite: 'performance' })],
    include: ['src/routes/cam/$jobId.plan.variedBoards.test.tsx'],
    testNamePattern: /\[performance\]/,
    fileParallelism: false,
  },
});
