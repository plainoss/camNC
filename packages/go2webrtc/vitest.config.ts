import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Vitest's default reporters, plus Mergify's.
    reporters: ['default', ...(process.env.GITHUB_ACTIONS === 'true' ? ['github-actions'] : []), '@mergifyio/vitest'],
  },
});
