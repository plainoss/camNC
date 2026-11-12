#!/usr/bin/env node
// Finds the PRs and CI runs that stall without anyone noticing, and flags them where agents and the health check look.
// - CI runs still queued long after their attempt started (an Actions outage leaves them queued with no jobs, and
//   `timeout-minutes` only counts once a job starts) are cancelled. A PR run at the PR's current head is rerun; a
//   merge-queue batch is left to Mergify, since a cancelled check ejects the batch anyway.
// - Open PRs that need someone: stacked on a merged or closed base, stacked more than two deep, conflicting, dequeued
//   from the merge queue and left there, or idle. Each gets the `needs-attention` label and one comment naming why;
//   the comment wakes a session that follows the PR, and the label is what the health check lists. Idle time counts
//   from the PR's last commit, not its last update, which the watchdog's own label and comment would reset.
// Runs main's copy from .github/workflows/pr-watchdog.yml and never checks out PR code.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const LABEL = 'needs-attention';
export const MERGIFY_BATCH = 'mergify/merge-queue/';
const HOUR = 3600_000;
// Long enough for a busy hour's runner queue (a few minutes at most), short enough to beat an outage's 13 hours.
export const STUCK_RUN_MS = 30 * 60_000;
export const IDLE_MS = 6 * HOUR;
export const DEQUEUED_MS = HOUR;
export const MAX_STACK_DEPTH = 2;

/**
 * The CI runs to cancel: queued for longer than STUCK_RUN_MS since their attempt started (`created_at` stays put across
 * reruns), not older than a day, and not merge-queue batches.
 */
export function stuckRuns(runs, now) {
  return runs.filter(run => {
    const age = now - Date.parse(run.run_started_at ?? run.created_at);
    return run.status === 'queued' && age > STUCK_RUN_MS && age < 24 * HOUR && !(run.head_branch ?? '').startsWith(MERGIFY_BATCH);
  });
}

/** Whether a cancelled run should run again: only a PR run at its PR's current head. Older commits and main pushes are superseded. */
export const shouldRerun = (run, prHeads) => run.event === 'pull_request' && prHeads.get(run.head_branch) === run.head_sha;

/** How many PRs deep a PR sits: 1 for a PR into main, 2 for one stacked on such a PR, and so on. */
export function stackDepth(pr, byHead, defaultBranch = 'main') {
  let depth = 1;
  const seen = new Set([pr.number]);
  const parent = open => (open.base === defaultBranch ? undefined : byHead.get(open.base));
  for (let base = parent(pr); base && !seen.has(base.number); base = parent(base)) {
    seen.add(base.number);
    depth++;
  }
  return depth;
}

/**
 * Why an open PR needs someone, or [] when it doesn't. `prs` are the open same-repository PRs as {number, head, base,
 * draft, labels, lastCommitAt, mergeable}; `closedHeads` maps a recently closed PR's head branch to {number, merged}.
 */
export function attentionReasons(pr, { prs, closedHeads, defaultBranch, now }) {
  if (pr.head.startsWith(MERGIFY_BATCH)) return [];
  const reasons = [];
  const byHead = new Map(prs.map(open => [open.head, open]));
  if (pr.base !== defaultBranch) {
    const parent = byHead.get(pr.base);
    const closed = closedHeads.get(pr.base);
    if (!parent && closed?.merged)
      reasons.push(`its base #${closed.number} merged: retarget it to \`${defaultBranch}\` and merge \`${defaultBranch}\` into it, which also starts its CI`);
    else if (!parent && closed)
      reasons.push(`its base #${closed.number} was closed without merging: this PR still carries that PR's commits`);
    else if (!parent) reasons.push(`its base branch \`${pr.base}\` has no open PR`);
    const depth = stackDepth(pr, byHead, defaultBranch);
    if (depth > MAX_STACK_DEPTH) reasons.push(`it is stacked ${depth} PRs deep (at most ${MAX_STACK_DEPTH}): squash the chain or land its base first`);
  }
  if (pr.draft) return reasons;
  if (pr.mergeable === 'CONFLICTING') reasons.push(`it conflicts with \`${pr.base}\``);
  const idle = now - Date.parse(pr.lastCommitAt);
  // Mergify labels a PR `dequeued` when it leaves the queue and `queued` while it is in it.
  if (pr.labels.includes('dequeued') && idle > DEQUEUED_MS)
    reasons.push('it left the merge queue and has not been requeued: fix the failure, or requeue it if the failure was a flake');
  else if (!pr.labels.includes('queued') && idle > IDLE_MS) reasons.push(`nothing has been pushed to it for ${Math.floor(idle / HOUR)} h`);
  return reasons;
}

export function comment(reasons) {
  return [
    'This PR needs attention:',
    '',
    ...reasons.map(reason => `- ${reason[0].toUpperCase()}${reason.slice(1)}.`),
    '',
    `The \`${LABEL}\` label comes off on the next watchdog run after this is resolved. Convert the PR to a draft if it should wait.`,
  ].join('\n');
}

const gh = args => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const json = args => JSON.parse(gh(args));

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const now = Date.now();
  const dryRun = Boolean(process.env.WATCHDOG_DRY_RUN);
  // One failed call (a PR closed mid-run, a run that finished before its cancel) must not stop the rest.
  const act = (description, args) => {
    console.log(description);
    if (dryRun) return true;
    try {
      gh(args);
      return true;
    } catch (error) {
      console.log(`  failed: ${error.message.split('\n')[0]}`);
      return false;
    }
  };

  const fields = 'number,headRefName,headRefOid,baseRefName,isDraft,isCrossRepository,labels,mergeable,commits';
  const open = json(['pr', 'list', '--repo', repo, '--state', 'open', '--limit', '200', '--json', fields]).filter(pr => !pr.isCrossRepository);
  const prs = open.map(pr => ({
    number: pr.number,
    head: pr.headRefName,
    base: pr.baseRefName,
    draft: pr.isDraft,
    labels: pr.labels.map(label => label.name),
    lastCommitAt: pr.commits.at(-1)?.committedDate ?? new Date(now).toISOString(),
    mergeable: pr.mergeable,
  }));
  const closed = json(['pr', 'list', '--repo', repo, '--state', 'closed', '--limit', '200', '--json', 'number,headRefName,mergedAt,isCrossRepository']);
  const closedHeads = new Map();
  // Newest first: a branch reused by a later PR keeps that PR's outcome.
  for (const pr of closed) if (!pr.isCrossRepository && !closedHeads.has(pr.headRefName)) closedHeads.set(pr.headRefName, { number: pr.number, merged: Boolean(pr.mergedAt) });
  const defaultBranch = json(['api', `repos/${repo}`, '--jq', '{default_branch}']).default_branch;

  if (!dryRun) gh(['label', 'create', LABEL, '--repo', repo, '--force', '--color', 'd93f0b', '--description', 'Flagged by the PR watchdog: stalled, orphaned or conflicting']);
  const summary = [];
  for (const pr of prs) {
    const reasons = attentionReasons(pr, { prs, closedHeads, defaultBranch, now });
    const flagged = pr.labels.includes(LABEL);
    if (reasons.length) summary.push(`#${pr.number}: ${reasons.join('; ')}`);
    if (reasons.length && !flagged) {
      if (act(`Flagging #${pr.number}: ${reasons.join('; ')}`, ['pr', 'edit', String(pr.number), '--repo', repo, '--add-label', LABEL]))
        act(`Commenting on #${pr.number}`, ['pr', 'comment', String(pr.number), '--repo', repo, '--body', comment(reasons)]);
    } else if (!reasons.length && flagged) {
      act(`Unflagging #${pr.number}`, ['pr', 'edit', String(pr.number), '--repo', repo, '--remove-label', LABEL]);
    }
  }
  console.log(summary.length ? `PRs that need attention:\n${summary.join('\n')}` : 'No PR needs attention.');

  const runs = json(['api', `repos/${repo}/actions/workflows/ci.yml/runs?status=queued&per_page=100`, '--jq',
    '[.workflow_runs[] | {id, status, event, head_branch, head_sha, created_at, run_started_at}]']);
  const prHeads = new Map(open.map(pr => [pr.headRefName, pr.headRefOid]));
  const cancelled = stuckRuns(runs, now).filter(run =>
    act(`Cancelling CI run ${run.id} (${run.head_branch}), queued since ${run.run_started_at}`, ['run', 'cancel', String(run.id), '--repo', repo]));
  const rerun = cancelled.filter(run => shouldRerun(run, prHeads));
  if (dryRun || !rerun.length) return;
  // A cancelled run can only be rerun once it has completed: wait for all of them at once, within the job's limit.
  const done = run => json(['api', `repos/${repo}/actions/runs/${run.id}`, '--jq', '{status}']).status === 'completed';
  for (let i = 0; i < 18 && !rerun.every(done); i++) await new Promise(resolve => setTimeout(resolve, 10_000));
  for (const run of rerun) act(`Rerunning CI run ${run.id}`, ['run', 'rerun', String(run.id), '--repo', repo]);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
