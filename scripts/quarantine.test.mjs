import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QUARANTINE_MS, quarantineEntry, quarantinedTests } from './quarantine.mjs';

test('quarantines the tests open flaky-test issues name, including cut titles and file-only names', () => {
  const long = `src/cad/CadEditor.test.tsx > editor > ${'x'.repeat(200)}`;
  const cut = `Flaky test: ${long}`.slice(0, 197) + '...';
  const now = Date.parse('2026-11-12T12:00:00Z');
  const updated_at = new Date(now - 3600_000).toISOString();
  const entries = quarantinedTests([
    { number: 1, title: 'Flaky test: src/scene/Canvas.test.tsx > canvas > draws' },
    { number: 2, title: cut },
    { number: 3, title: 'Flaky test: Viewer.test.tsx > viewer > loads' },
    { number: 4, title: 'Spec harness flakes' },
    { number: 5, title: 'Flaky test: src/pr.test.ts > pr', pull_request: {} },
    // Quiet for longer than the quarantine lasts.
    { number: 6, title: 'Flaky test: src/old.test.ts > old', updated_at: new Date(now - QUARANTINE_MS - 1).toISOString() },
    // Failed its non-gating run, so batches run it again.
    { number: 7, title: 'Flaky test: src/broken.test.ts > broken', labels: [{ name: 'quarantine-lifted' }] },
  ].map(issue => ({ updated_at, ...issue })), now);
  assert.deepEqual(entries.map(entry => entry.issue), [1, 2, 3]);
  assert.equal(entries[1].prefix, true);
  assert.equal(quarantineEntry('src/scene/Canvas.test.tsx > canvas > draws', entries)?.issue, 1);
  assert.equal(quarantineEntry('src/scene/Canvas.test.tsx > canvas > draws twice', entries), undefined);
  assert.equal(quarantineEntry(long, entries)?.issue, 2);
  assert.equal(quarantineEntry('src/viewer/Viewer.test.tsx > viewer > loads', entries)?.issue, 3);
  assert.equal(quarantineEntry('src/viewer/OtherViewer.test.tsx > viewer > loads', entries), undefined);
});
