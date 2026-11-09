import assert from 'node:assert/strict';
import { test } from 'vitest';
import { waitSettled } from './settle.mjs';

/** A page whose wait times out, reporting `snapshot` when asked what is still pending. */
const stuckPage = snapshot => ({
  waitForFunction: async () => {
    throw new Error('page.waitForFunction: Timeout 10ms exceeded.');
  },
  evaluate: async () => snapshot,
});

test('a step that never settles fails naming what is still pending', async () => {
  const page = stuckPage({ load: 1, revision: 3, pending: { solve: 1, worker: 0, save: 2, route: 0, query: 0, frame: 1 } });
  await assert.rejects(waitSettled(page, null, 10), {
    message: 'The app did not settle within 0.01 s: still pending: solve 1, save 2, frame 1',
  });
});

test('a page without the signal says so', async () => {
  await assert.rejects(waitSettled(stuckPage(null), null, 10), /no settled signal/);
});

test('other errors pass through unchanged', async () => {
  const page = { waitForFunction: async () => Promise.reject(new Error('Target page, context or browser has been closed')) };
  await assert.rejects(waitSettled(page), /has been closed/);
});
