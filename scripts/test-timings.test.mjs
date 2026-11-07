import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeFiles } from './test-timings.mjs';

test('timings retain uncollected failures and distinguish collection from test work', () => {
  assert.deepEqual(summarizeFiles([
    { filepath: '/repo/a.test.ts', result: { state: 'pass', duration: 20 }, collectDuration: 100 },
    { filepath: '/repo/b.test.ts', result: { state: 'fail' } },
    { filepath: '/repo/c.test.ts', result: { state: 'pass', duration: 200 }, setupDuration: 10 },
  ], '/repo'), [
    { file: 'c.test.ts', state: 'pass', testsMs: 200, collectMs: 0, setupMs: 10, environmentMs: 0, prepareMs: 0 },
    { file: 'a.test.ts', state: 'pass', testsMs: 20, collectMs: 100, setupMs: 0, environmentMs: 0, prepareMs: 0 },
    { file: 'b.test.ts', state: 'fail', testsMs: 0, collectMs: 0, setupMs: 0, environmentMs: 0, prepareMs: 0 },
  ]);
});
