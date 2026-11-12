import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attentionReasons, comment, shouldRerun, stackDepth, stuckRuns } from './pr-watchdog.mjs';

const now = Date.parse('2026-11-12T12:00:00Z');
const ago = minutes => new Date(now - minutes * 60_000).toISOString();
const pr = (number, head, base, extra = {}) => ({ number, head, base, draft: false, labels: [], lastCommitAt: ago(10), mergeable: 'MERGEABLE', ...extra });
const reasons = (target, prs, closedHeads = new Map()) => attentionReasons(target, { prs, closedHeads, defaultBranch: 'main', now });

test('only runs whose attempt has been queued for more than 30 minutes, within the last day, are cancelled', () => {
  const runs = [
    { id: 1, status: 'queued', created_at: ago(5), run_started_at: ago(5) },
    { id: 2, status: 'queued', created_at: ago(45), run_started_at: ago(45) },
    { id: 3, status: 'in_progress', created_at: ago(45), run_started_at: ago(45) },
    { id: 4, status: 'queued', created_at: ago(25 * 60), run_started_at: ago(25 * 60) },
    // A rerun keeps its created_at: its new attempt is only a few minutes old.
    { id: 5, status: 'queued', created_at: ago(120), run_started_at: ago(3) },
    // Cancelling a batch's check ejects the batch, so batches are left to Mergify.
    { id: 6, status: 'queued', created_at: ago(45), run_started_at: ago(45), head_branch: 'mergify/merge-queue/abc' },
  ];
  assert.deepEqual(stuckRuns(runs, now).map(run => run.id), [2]);
});

test('only a PR run at its PR head is rerun after the cancel', () => {
  const heads = new Map([['feature', 'new']]);
  assert.equal(shouldRerun({ event: 'pull_request', head_branch: 'feature', head_sha: 'new' }, heads), true);
  assert.equal(shouldRerun({ event: 'pull_request', head_branch: 'feature', head_sha: 'old' }, heads), false);
  assert.equal(shouldRerun({ event: 'push', head_branch: 'main', head_sha: 'x' }, heads), false);
});

test('a stack counts every open PR between a PR and main', () => {
  const prs = [pr(1, 'a', 'main'), pr(2, 'b', 'a'), pr(3, 'c', 'b')];
  const byHead = new Map(prs.map(p => [p.head, p]));
  assert.deepEqual(prs.map(p => stackDepth(p, byHead)), [1, 2, 3]);
  // A cycle of bases ends instead of looping.
  const loop = [pr(4, 'x', 'y'), pr(5, 'y', 'x')];
  assert.equal(stackDepth(loop[0], new Map(loop.map(p => [p.head, p]))), 2);
});

test('a PR whose base merged, was closed or vanished is flagged, and so is a stack deeper than two', () => {
  const merged = pr(2, 'child', 'parent');
  assert.match(reasons(merged, [merged], new Map([['parent', { number: 1, merged: true }]]))[0], /base #1 merged: retarget it/);
  assert.match(reasons(merged, [merged], new Map([['parent', { number: 1, merged: false }]]))[0], /closed without merging/);
  assert.match(reasons(merged, [merged])[0], /has no open PR/);
  const chain = [pr(1, 'a', 'main'), pr(2, 'b', 'a'), pr(3, 'c', 'b')];
  assert.deepEqual(reasons(chain[1], chain), []);
  assert.match(reasons(chain[2], chain)[0], /stacked 3 PRs deep/);
});

test('a ready PR is flagged when it conflicts, sits dequeued or idles, and a draft only for its stack', () => {
  assert.deepEqual(reasons(pr(1, 'a', 'main'), []), []);
  assert.match(reasons(pr(1, 'a', 'main', { mergeable: 'CONFLICTING' }), [])[0], /conflicts with `main`/);
  assert.deepEqual(reasons(pr(1, 'a', 'main', { labels: ['dequeued'], lastCommitAt: ago(30) }), []), []);
  assert.match(reasons(pr(1, 'a', 'main', { labels: ['dequeued'], lastCommitAt: ago(90) }), [])[0], /left the merge queue/);
  assert.match(reasons(pr(1, 'a', 'main', { lastCommitAt: ago(7 * 60) }), [])[0], /nothing has been pushed to it for 7 h/);
  assert.deepEqual(reasons(pr(1, 'a', 'main', { labels: ['queued'], lastCommitAt: ago(7 * 60) }), []), [], 'a queued PR is not idle');
  assert.deepEqual(reasons(pr(1, 'a', 'main', { draft: true, mergeable: 'CONFLICTING', lastCommitAt: ago(7 * 60) }), []), []);
  assert.deepEqual(reasons(pr(9, 'mergify/merge-queue/main/batch', 'main', { lastCommitAt: ago(7 * 60) }), []), []);
});

test('the comment lists each reason as a sentence', () => {
  assert.equal(comment(['it conflicts with `main`']).split('\n')[2], '- It conflicts with `main`.');
});
