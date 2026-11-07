import TimingReporter from '../../scripts/test-timings.mjs';
import { defineConfig, mergeConfig } from 'vitest/config';
import config from './vitest.config';

export default mergeConfig(
  config,
  defineConfig({
    test: {
      reporters: ['default', new TimingReporter({ suite: 'performance' })],
      include: ['src/cam/boards.test.ts', 'src/routes/cam/$jobId.plan.variedBoards.test.tsx'],
      testNamePattern: /\[performance\]/,
      fileParallelism: false,
    },
  })
);
