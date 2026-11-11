import { defineConfig } from 'vitest/config';
import config from './vitest.config';
import { liveCommands } from './src/cad/assistant/live/serverCommands';

/**
 * Opt-in live provider runs of the design assistant (ASSISTANT_LIVE=1). Not part of any CI suite.
 * ASSISTANT_LIVE=1 ASSISTANT_VARIANT=baseline pnpm vitest run --config vitest.assistant-live.config.ts
 */
// Only non-secret run settings reach the page; provider keys stay in the Node-side fetch command.
const settings = Object.fromEntries(
  ['ASSISTANT_LIVE', 'ASSISTANT_VARIANT', 'ASSISTANT_LIVE_MODEL', 'ASSISTANT_LIVE_REPS', 'ASSISTANT_LIVE_TASKS', 'ASSISTANT_LIVE_REPLIES'].map(name => [
    name,
    process.env[name],
  ])
);

export default defineConfig({
  ...config,
  define: { __ASSISTANT_LIVE__: JSON.stringify(settings) },
  test: {
    ...config.test,
    reporters: ['default'],
    include: ['src/cad/assistant/live/**/*.live.ts'],
    testNamePattern: undefined,
    fileParallelism: false,
    maxConcurrency: Number(process.env.ASSISTANT_LIVE_CONCURRENCY ?? 4),
    testTimeout: 600_000,
    browser: { ...config.test!.browser!, commands: liveCommands } as NonNullable<NonNullable<typeof config.test>['browser']>,
  },
});
