import { defineConfig } from 'vitest/config';
import TimingReporter from '../../scripts/test-timings.mjs';
export default defineConfig({
  test: { environment: 'node', maxWorkers: 2, reporters: ['default', new TimingReporter({ suite: 'cad-editor' }), '@mergifyio/vitest'] },
});
