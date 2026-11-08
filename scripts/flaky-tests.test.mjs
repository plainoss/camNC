import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attemptToRead, issueTitle, parseFailures } from './flaky-tests.mjs';

test('reads failed specs and Vitest tests from a job log, each once', () => {
  const log = [
    '2026-11-08T10:50:59.1Z @wbcnc/camNC:spec:cad: FAIL  sketch/machine/edit-after-cut-keeps-boards',
    '2026-11-08T10:51:00.1Z @wbcnc/camNC:test:browser: \x1b[41m\x1b[1m FAIL \x1b[22m\x1b[49m \x1b[30m\x1b[43m chromium \x1b[49m\x1b[39m src/cad/CadEditor.test.tsx\x1b[2m > \x1b[22mintegrated sketch editor',
    '2026-11-08T10:51:00.2Z @wbcnc/cad-script:test:  FAIL  src/cadScript.test.ts > toolpath summary > counts each pocket',
    '2026-11-08T10:51:00.3Z @wbcnc/cad-script:test:  FAIL  src/cadScript.test.ts > toolpath summary > counts each pocket',
    '2026-11-08T10:51:00.4Z @wbcnc/camNC:test:browser:  ✓ src/scene/CanvasLabel.test.tsx (5 tests)',
    '2026-11-08T10:51:00.5Z  ERROR  run failed: command  exited (1)',
  ].join('\n');
  assert.deepEqual(parseFailures(log), [
    'sketch/machine/edit-after-cut-keeps-boards',
    'src/cad/CadEditor.test.tsx > integrated sketch editor',
    'src/cadScript.test.ts > toolpath summary > counts each pocket',
  ]);
});

test('only a failed queue run or a fixed rerun counts as a flake', () => {
  assert.equal(attemptToRead({ event: 'merge_group', conclusion: 'failure', attempt: 1 }), 1);
  assert.equal(attemptToRead({ event: 'pull_request', conclusion: 'success', attempt: 3 }), 2);
  assert.equal(attemptToRead({ event: 'pull_request', conclusion: 'failure', attempt: 1 }), null);
  assert.equal(attemptToRead({ event: 'merge_group', conclusion: 'success', attempt: 1 }), null);
  assert.equal(attemptToRead({ event: 'merge_group', conclusion: 'cancelled', attempt: 1 }), null);
});

test('issue titles stay within GitHub limits and name the test', () => {
  assert.equal(issueTitle('sketch/a'), 'Flaky test: sketch/a');
  assert.equal(issueTitle('x'.repeat(300)).length, 200);
});
