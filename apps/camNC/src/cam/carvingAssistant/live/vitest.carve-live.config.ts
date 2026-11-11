import path from 'node:path';
import { defineConfig } from 'vitest/config';
import config from '../../../../vitest.config';
import { carveLiveCommands } from './serverCommands';

/**
 * Opt-in live provider runs of the carving assistant. Not part of any suite: the file pattern (*.live.ts) is
 * outside the default include, and the test itself skips unless CARVE_LIVE=1.
 * From apps/camNC:
 *   CARVE_LIVE=1 CARVE_VARIANT=baseline pnpm vitest run --config src/cam/carvingAssistant/live/vitest.carve-live.config.ts
 */
export default defineConfig({
  ...config,
  root: path.resolve(__dirname, '../../../..'),
  test: {
    ...config.test,
    reporters: ['default'],
    include: ['src/cam/carvingAssistant/live/**/*.live.ts'],
    testNamePattern: undefined,
    fileParallelism: false,
    testTimeout: 3_600_000,
    browser: { ...config.test!.browser!, commands: carveLiveCommands } as NonNullable<NonNullable<typeof config.test>['browser']>,
  },
});
