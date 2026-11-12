import assert from 'node:assert/strict';
import { test } from 'node:test';
import { retriedTests, summarizeFiles } from './test-timings.mjs';

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

test('lists the tests that passed only on a retry, by file and describe blocks', () => {
  const file = {
    filepath: '/repo/src/a.test.ts',
    tasks: [
      { type: 'test', name: 'passes first time', result: { state: 'pass', retryCount: 0 } },
      { type: 'suite', name: 'group', tasks: [
        { type: 'test', name: 'passes on a retry', result: { state: 'pass', retryCount: 1 } },
        { type: 'test', name: 'fails every try', result: { state: 'fail', retryCount: 1 } },
      ] },
    ],
  };
  assert.deepEqual(retriedTests([file], '/repo'), ['src/a.test.ts > group > passes on a retry']);
});
