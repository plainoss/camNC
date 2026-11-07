import { readFileSync } from 'node:fs';
import { defineConfig, mergeConfig } from 'vitest/config';
import config from './vitest.config';

// Slow browser files, including the split board workflows. CI always runs them.
const slowest: string[] = JSON.parse(readFileSync(new URL('./vitest.fast-excludes.json', import.meta.url), 'utf8'));

export default mergeConfig(config, defineConfig({ test: { exclude: slowest } }));
