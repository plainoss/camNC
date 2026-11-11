import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import config from '../../../vitest.config';
import { liveCommands } from './commands';

/**
 * Vitest config for one opt-in live harness. The harness files end in .live.ts, outside every default include,
 * and their tests skip unless `<prefix>=1` is set.
 */
export function liveVitestConfig({
  name,
  prefix,
  include,
  testTimeout,
}: {
  name: string;
  prefix: string;
  include: string;
  testTimeout: number;
}) {
  const env = process.env;
  const outDir = path.resolve(env[`${prefix}_OUT`] ?? fileURLToPath(new URL(`../../../test-results/live/${name}`, import.meta.url)));
  // Only this harness's own non-secret settings are inlined into the page; provider keys stay in commands.ts.
  const settings = Object.fromEntries(
    Object.entries(env).filter(([key]) => new RegExp(`^${prefix}(_[A-Z0-9_]+)?$`).test(key) && !/KEY|TOKEN|SECRET/.test(key))
  );
  return defineConfig({
    ...config,
    // Own dependency cache: `define` is part of Vite's optimizer hash, so sharing the default cache would make the
    // next normal run re-optimize its dependencies mid-run and reload test pages.
    cacheDir: `node_modules/.vite/live-${name}`,
    define: { __LIVE_ENV__: JSON.stringify({ ...settings, [`${prefix}_OUT`]: outDir }) },
    test: {
      ...config.test,
      reporters: ['default'],
      include: [include],
      testNamePattern: undefined,
      fileParallelism: false,
      maxConcurrency: Number(env[`${prefix}_CONCURRENCY`] ?? 4),
      testTimeout,
      browser: {
        ...config.test!.browser!,
        commands: liveCommands({
          outDir,
          budgetUsd: Number(env[`${prefix}_BUDGET_USD`] ?? 2),
          reserveUsd: Number(env[`${prefix}_RESERVE_USD`] ?? 0.03),
        }),
      },
    } as NonNullable<typeof config.test>,
  });
}
