import { defineConfig } from 'vitest/config';

// Everything in this package runs without a browser: Node has WebSocket, fetch and TextDecoder.
export default defineConfig({
  test: {
    globals: false,
    // Vitest's default reporters, plus Mergify's.
    reporters: ['default', ...(process.env.GITHUB_ACTIONS === 'true' ? ['github-actions'] : []), '@mergifyio/vitest'],
    environment: 'node',
  },
});
