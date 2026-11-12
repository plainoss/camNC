import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attemptToRead, batchPullRequests, clearsBatches, coveredBy, duplicatesOf, issueFor, issueTitle, parseFailures, parseRetries, testedHead } from './flaky-tests.mjs';

test('reads failed specs and Vitest tests from a job log, each once', () => {
  const log = [
    '2026-11-08T10:50:59.1Z @wbcnc/camNC:spec:cad: FAIL  sketch/machine/edit-after-cut-keeps-boards',
    '2026-11-08T10:51:00.1Z @wbcnc/camNC:test:browser: \x1b[41m\x1b[1m FAIL \x1b[22m\x1b[49m \x1b[30m\x1b[43m chromium \x1b[49m\x1b[39m src/cad/CadEditor.test.tsx\x1b[2m > \x1b[22mintegrated sketch editor',
    '2026-11-08T10:51:00.2Z @wbcnc/cad-script:test:  FAIL  src/cadScript.test.ts > toolpath summary > counts each pocket',
    '2026-11-08T10:51:00.3Z @wbcnc/cad-script:test:  FAIL  src/cadScript.test.ts > toolpath summary > counts each pocket',
    '2026-11-08T10:51:00.4Z @wbcnc/camNC:test:browser:  ✓ src/scene/CanvasLabel.test.tsx (5 tests)',
    '2026-11-08T10:51:00.5Z  ERROR  run failed: command  exited (1)',
    '2026-11-08T10:52:00.1Z  FAIL  src/sim.integration.test.ts > FluidNC simulator > streams a job',
  ].join('\n');
  assert.deepEqual(parseFailures(log), [
    'sketch/machine/edit-after-cut-keeps-boards',
    'src/cad/CadEditor.test.tsx > integrated sketch editor',
    'src/cadScript.test.ts > toolpath summary > counts each pocket',
    'src/sim.integration.test.ts > FluidNC simulator > streams a job',
  ]);
});

test('only a fixed rerun or a later passing batch counts as a flake', () => {
  assert.equal(attemptToRead({ event: 'pull_request', conclusion: 'success', attempt: 3 }), 2);
  assert.equal(attemptToRead({ event: 'pull_request', conclusion: 'success', attempt: 1 }), null);
  assert.equal(attemptToRead({ event: 'pull_request', conclusion: 'failure', attempt: 1 }), null);
  assert.equal(attemptToRead({ event: 'pull_request', conclusion: 'cancelled', attempt: 2 }), null);
  // A failed Mergify batch is not reported when it fails, but when a batch with the same commits passes.
  const batch = 'mergify/merge-queue/d49b391ce9';
  assert.equal(attemptToRead({ event: 'pull_request', conclusion: 'failure', attempt: 1, branch: batch }), null);
  assert.equal(clearsBatches({ event: 'pull_request', conclusion: 'success', branch: batch }), true);
  assert.equal(clearsBatches({ event: 'pull_request', conclusion: 'failure', branch: batch }), false);
  assert.equal(clearsBatches({ event: 'pull_request', conclusion: 'success', branch: 'feat/x' }), false);
});

test('issue titles stay within GitHub limits and name the test', () => {
  assert.equal(issueTitle('sketch/a'), 'Flaky test: sketch/a');
  assert.equal(issueTitle('x'.repeat(300)).length, 200);
});

test('a raced report keeps the oldest issue for a test and closes the others', () => {
  const issues = [
    { number: 12, title: 'Flaky test: a' },
    { number: 9, title: 'Flaky test: a' },
    { number: 10, title: 'Flaky test: b' },
  ];
  assert.deepEqual(duplicatesOf(issues, 'Flaky test: a'), { keep: issues[1], close: [issues[0]] });
  assert.deepEqual(duplicatesOf(issues, 'Flaky test: b').close, []);
});

test('a Mergify batch draft names the PRs it tests, including batches ahead of it', () => {
  const body = [
    'Mergify opened it for batch **cyan-poulet-es44ws** of the `main` queue, to test [#375](/plainoss/camNC/pull/375).',
    '1. `main` at [`440a182`](/plainoss/camNC/commit/440a182c302afd277c88998743a452405d5b675b)',
    '2. [#376](/plainoss/camNC/pull/376), ahead in the queue',
    '3. [#375](/plainoss/camNC/pull/375), the pull request of this batch',
    'This draft: [#380](/plainoss/camNC/pull/380)',
  ].join('\n');
  assert.deepEqual(batchPullRequests(body, 380), [375, 376]);
  assert.deepEqual(batchPullRequests(undefined, 380), []);
});

test('a batch is judged by the PR commit it tested, not a later fix', () => {
  const draft = new Set(['0b95', '955e', '308b', 'c7de']);
  assert.equal(testedHead(['955e', '308b', '2e82'], draft), '308b');
  assert.equal(testedHead(['aaaa'], draft), null);
});

test('a failed batch counts as flaky only when a passing batch tested each of its PRs at the same commit', () => {
  const failed = new Map([
    [375, '308b'],
    [376, '0b95'],
  ]);
  assert.equal(coveredBy(failed, new Map([[376, '0b95'], [375, '308b'], [380, 'aaaa']])), true);
  // #375 failed at 308b and only passed after a fix at 2e82: that failure was real.
  assert.equal(coveredBy(new Map([[375, '308b']]), new Map([[375, '2e82']])), false);
  assert.equal(coveredBy(failed, new Map([[376, '0b95']])), false);
  assert.equal(coveredBy(new Map([[375, null]]), new Map([[375, null]])), false);
  assert.equal(coveredBy(new Map(), new Map([[375, '308b']])), false);
});

test('reads the tests that passed only on a retry from a job log, each once', () => {
  const log = [
    '2026-11-12T10:00:00.0000000Z @wbcnc/camNC:test:browser: RETRIED [run 42] src/cad/CadEditor.studio.test.tsx > moves a part',
    '2026-11-12T10:00:01.0000000Z \x1b[33mRETRIED [run 42] src/cad/CadEditor.studio.test.tsx > moves a part\x1b[39m',
    '2026-11-12T10:00:02.0000000Z  ✓ src/cad/other.test.tsx > passes',
    // A turbo cache replay of an earlier run's log was reported when that run passed.
    '2026-11-12T10:00:03.0000000Z @wbcnc/camNC:test:browser: RETRIED [run 17] src/cad/old.test.tsx > flaked before',
  ].join('\n');
  assert.deepEqual(parseRetries(log, 42), ['src/cad/CadEditor.studio.test.tsx > moves a part']);
});

test('a flake goes to its open issue, else reopens its closed one, else files a new issue', () => {
  const title = 'Flaky test: a > b';
  assert.deepEqual(issueFor([{ number: 3, title, state: 'CLOSED' }, { number: 9, title, state: 'OPEN' }], title),
    { action: 'comment', number: 9 });
  assert.deepEqual(issueFor([
    { number: 3, title, state: 'CLOSED', stateReason: 'COMPLETED' },
    { number: 5, title, state: 'CLOSED', stateReason: 'NOT_PLANNED' },
    { number: 7, title: 'Flaky test: other', state: 'OPEN' },
  ], title), { action: 'reopen', number: 3 });
  assert.deepEqual(issueFor([
    { number: 3, title, state: 'CLOSED', stateReason: 'NOT_PLANNED' },
    { number: 5, title, state: 'CLOSED', stateReason: 'DUPLICATE' },
  ], title), { action: 'reopen', number: 3 }, 'with only duplicates closed, the oldest is the original');
  assert.deepEqual(issueFor([{ number: 7, title: 'Flaky test: other', state: 'OPEN' }], title), { action: 'create' });
});
