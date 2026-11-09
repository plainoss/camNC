import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    // Vitest's default reporters, plus a JUnit report for Mergify instead of its reporter, whose runner setup cannot
    // load in workerd.
    reporters: ['default', ...(process.env.GITHUB_ACTIONS === 'true' ? ['github-actions'] : []), 'junit'],
    outputFile: { junit: 'test-results/junit/worker.xml' },
    poolOptions: {
      workers: {
        // Open WebSockets keep Durable Objects alive past a test; every test uses its own room anyway.
        isolatedStorage: false,
        singleWorker: true,
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: { ALLOWED_ORIGINS: 'https://run.camnc.app,https://*.workers.dev' },
        },
      },
    },
  },
});
