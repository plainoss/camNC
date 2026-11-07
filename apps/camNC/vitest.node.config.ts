import path from 'node:path';
import { defineConfig } from 'vitest/config';
import TimingReporter from '../../scripts/test-timings.mjs';
import files from './vitest.node-files.json';

// Deliberately does not inherit React, CSS, Node polyfills, or IndexedDB setup.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    name: 'domain',
    environment: 'node',
    include: files,
    maxWorkers: 2,
    reporters: ['default', new TimingReporter({ suite: 'domain' })],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
