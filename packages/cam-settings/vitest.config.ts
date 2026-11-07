import TimingReporter from '../../scripts/test-timings.mjs';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    reporters: ['default', new TimingReporter({ suite: 'cam-settings' })],
    environment: 'node',
  },
});
