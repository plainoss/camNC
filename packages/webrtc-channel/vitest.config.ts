/// <reference types="@vitest/browser/providers/playwright" />
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: false,
    // Vitest's default reporters, plus Mergify's.
    reporters: ['default', ...(process.env.GITHUB_ACTIONS === 'true' ? ['github-actions'] : []), '@mergifyio/vitest'],
    // environment: 'jsdom',
    // opencv tests don't seem to work with jsdom as setup right now.
    browser: {
      screenshotFailures: false,
      enabled: true,
      headless: true,
      provider: 'playwright',
      // Mock keychain: otherwise macOS asks for "Chromium Safe Storage" access on every run.
      instances: [{ browser: 'chromium', launch: { args: ['--use-mock-keychain', '--password-store=basic'] } }],
    },
  },
});
