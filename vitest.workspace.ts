import { defineWorkspace } from 'vitest/config';

// using deprecated config until vitest vscode extension is updated
export default defineWorkspace(['./apps/*/vitest.config.ts', './apps/*/vitest.node.config.ts', './packages/*/vitest.config.ts']);
