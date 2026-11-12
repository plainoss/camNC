import assert from 'node:assert/strict';
import { test } from 'node:test';
import { quarantineEntry, quarantinedTests } from './quarantine.mjs';

test('quarantines the tests open flaky-test issues name, including cut titles and file-only names', () => {
  const long = `src/cad/CadEditor.test.tsx > editor > ${'x'.repeat(200)}`;
  const cut = `Flaky test: ${long}`.slice(0, 197) + '...';
  const entries = quarantinedTests([
    { number: 1, title: 'Flaky test: src/scene/Canvas.test.tsx > canvas > draws' },
    { number: 2, title: cut },
    { number: 3, title: 'Flaky test: Viewer.test.tsx > viewer > loads' },
    { number: 4, title: 'Spec harness flakes' },
    { number: 5, title: 'Flaky test: src/pr.test.ts > pr', pull_request: {} },
  ]);
  assert.deepEqual(entries.map(entry => entry.issue), [1, 2, 3]);
  assert.equal(entries[1].prefix, true);
  assert.equal(quarantineEntry('src/scene/Canvas.test.tsx > canvas > draws', entries)?.issue, 1);
  assert.equal(quarantineEntry('src/scene/Canvas.test.tsx > canvas > draws twice', entries), undefined);
  assert.equal(quarantineEntry(long, entries)?.issue, 2);
  assert.equal(quarantineEntry('src/viewer/Viewer.test.tsx > viewer > loads', entries)?.issue, 3);
  assert.equal(quarantineEntry('src/viewer/OtherViewer.test.tsx > viewer > loads', entries), undefined);
});
