#!/usr/bin/env node
// Files a `flaky-test` issue for each test that failed in a CI run but passed on the same code: a failed Mergify batch
// whose PRs later passed in another batch at the same commits, or a failed attempt that a rerun fixed. Each later flake comments on the open issue for that test,
// so every session sees who already owns it before patching the same failure into its own branch.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { quarantineEntry, quarantinedTests } from './quarantine.mjs';

export const LABEL = 'flaky-test';

// Drops the runner's timestamp and colours.
const logLine = raw => raw.replace(/\x1b\[[0-9;]*m/g, '').replace(/^\S+Z /, '').trimEnd();

/** The failed tests in a job log: behaviour spec scenarios and Vitest tests, each once. */
export function parseFailures(log) {
  const failures = new Set();
  for (const raw of log.split('\n')) {
    const line = logLine(raw);
    // Turbo prefixes each line with its task; a direct `pnpm vitest run` step, such as the simulator tests, does not.
    const match = /^(?:@[^\s:]+:[^\s]+:)?\s*FAIL\s+(?:chromium\s+)?(.+)$/.exec(line);
    if (match) failures.add(match[1].trim());
  }
  return [...failures];
}

/**
 * The tests a job's log says passed only on a retry in run `runId`: the RETRIED lines scripts/test-timings.mjs prints.
 * Lines of another run are a turbo cache replay, already reported when that run passed.
 */
export function parseRetries(log, runId, tag = 'RETRIED') {
  const retried = new Set();
  const pattern = new RegExp(`^(?:@[^\\s:]+:[^\\s]+:)?\\s*${tag}\\s+\\[run (\\S+)\\]\\s+(.+)$`);
  for (const raw of log.split('\n')) {
    const match = pattern.exec(logLine(raw));
    if (match && match[1] === String(runId)) retried.add(match[2].trim());
  }
  return [...retried];
}

export const MERGIFY_BATCH = 'mergify/merge-queue/';

/**
 * Which attempt to read, or null when the run says nothing about flakiness. A failed Mergify batch is judged later,
 * when a batch with the same PR commits passes (see `coveredBy`), since PR runs skip the browser suites and specs.
 */
export function attemptToRead({ conclusion, attempt }) {
  if (conclusion === 'success' && attempt > 1) return attempt - 1;
  return null;
}

/** A finished Mergify batch, passed or failed, reports the browser tests its passing shards retried. */
export const readsRetries = ({ event, conclusion, branch = '' }) =>
  event === 'pull_request' && ['success', 'failure'].includes(conclusion) && branch.startsWith(MERGIFY_BATCH);

/** A passing Mergify batch can clear earlier failed ones. */
export const clearsBatches = ({ event, conclusion, branch = '' }) =>
  event === 'pull_request' && conclusion === 'success' && branch.startsWith(MERGIFY_BATCH);

/**
 * Whether a passing batch tested every PR of a failed batch at the same commit: the same code failed and then passed.
 * Both map PR numbers to the PR commit their batch tested. A PR's older commits are in every later batch too, so only
 * the tested head itself counts.
 */
export const coveredBy = (failedHeads, passingHeads) =>
  failedHeads.size > 0 && [...failedHeads].every(([pr, sha]) => sha && passingHeads.get(pr) === sha);

/** The PRs a Mergify batch draft tests, from the links in its description: the batch and any batches ahead of it. */
export function batchPullRequests(body, draft) {
  const numbers = [...(body ?? '').matchAll(/\/pull\/(\d+)\b/g)].map(match => Number(match[1]));
  return [...new Set(numbers)].filter(number => number !== draft);
}

/** The newest of a PR's commits that a batch draft contains: the PR as the queue tested it. */
export function testedHead(prCommits, draftCommits) {
  return prCommits.findLast(sha => draftCommits.has(sha)) ?? null;
}

export function issueTitle(test) {
  const title = `Flaky test: ${test}`;
  return title.length > 200 ? `${title.slice(0, 197)}...` : title;
}

const gh = (args, input) => execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
const api = (path, jq) => gh(['api', path, ...(jq ? ['--jq', jq] : [])]).trim();

// `gh api` refuses a response with terminal escape sequences, and test logs are full of colours, so fetch logs directly.
async function jobLog(repo, id) {
  const token = process.env.GH_TOKEN || gh(['auth', 'token']).trim();
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/jobs/${id}/logs`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`logs of job ${id}: HTTP ${res.status}`);
  return res.text();
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const run = {
    id: process.env.RUN_ID,
    event: process.env.RUN_EVENT,
    conclusion: process.env.RUN_CONCLUSION,
    branch: process.env.RUN_BRANCH ?? '',
    attempt: Number(process.env.RUN_ATTEMPT),
  };
  const commits = number => JSON.parse(api(`repos/${repo}/pulls/${number}/commits?per_page=100`, '[.[].sha]'));
  const draftOf = branch =>
    JSON.parse(api(`repos/${repo}/pulls?head=${repo.split('/')[0]}:${branch}&state=all`, '[.[0] | {number, body}]'))[0];

  if (clearsBatches(run)) {
    // A Mergify batch passed: report each recent failed batch whose PR commits it contains all of.
    // Links to other batch drafts (a batch split from a failed one) are not PRs under test.
    const isDraft = pr => api(`repos/${repo}/pulls/${pr}`, '.head.ref').startsWith(MERGIFY_BATCH);
    const testedHeads = draft => {
      const tested = new Set(commits(draft.number));
      const prs = batchPullRequests(draft.body, draft.number).filter(pr => !isDraft(pr));
      return new Map(prs.map(pr => [pr, testedHead(commits(pr), tested)]));
    };
    const passing = testedHeads(draftOf(run.branch));
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const failed = JSON.parse(api(`repos/${repo}/actions/runs?event=pull_request&status=failure&per_page=100&created=>=${since}`,
      `[.workflow_runs[] | select(.name == "CI" and (.head_branch | startswith("${MERGIFY_BATCH}"))) | {id, run_attempt, head_branch}]`));
    for (const failure of failed) {
      const draft = draftOf(failure.head_branch);
      if (!draft) continue;
      const failedHeads = testedHeads(draft);
      if (!coveredBy(failedHeads, passing)) continue;
      const failedUrl = `https://github.com/${repo}/actions/runs/${failure.id}/attempts/${failure.run_attempt}`;
      // One report per failed batch, however many later batches pass.
      const known = api(`search/issues?q=${encodeURIComponent(`repo:${repo} label:${LABEL} ${failure.id}`)}`, '.total_count');
      if (known !== '0') continue;
      const list = [...failedHeads.keys()].map(pr => `#${pr}`).join(', ');
      await report(repo, failure.id, failure.run_attempt,
        `A Mergify batch failed ${failedUrl} for ${list}, and a later batch with the same commits passed: https://github.com/${repo}/actions/runs/${run.id}. It can also be an interaction with a PR that was in the failed batch only.`);
    }
    // A batch that passed on a rerun also reports its failed attempt, below.
  }

  // Batches retry a failed browser test once (VITEST_RETRY): a test that passed only on its retry is a flake too, in a
  // batch that failed on another job as well. Each run reports its own retries when it completes.
  if (readsRetries(run)) await reportRetries(repo, run.id, run.attempt, run.branch);

  const attempt = attemptToRead(run);
  const runUrl = `https://github.com/${repo}/actions/runs/${run.id}/attempts/${attempt}`;
  if (attempt !== null) await report(repo, run.id, attempt, `A rerun of the same commit passed: ${runUrl}`);
  // After the reports, so a flake this run filed counts as a recurrence.
  if (!process.env.FLAKY_DRY_RUN) closeQuiet(repo);
}

async function report(repo, runId, attempt, context) {
  const jobs = JSON.parse(api(`repos/${repo}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`,
    '[.jobs[] | select(.conclusion == "failure" and .name != "Run tests") | {id, name}]'));
  const flakes = new Map();
  for (const job of jobs) {
    const tests = parseFailures(await jobLog(repo, job.id));
    // A job that hung or failed outside a test still gets one issue, under its own name.
    for (const test of tests.length ? tests : [`${job.name} (no failing test in its log)`]) flakes.set(test, job.name);
  }
  await file(repo, flakes, test => `\`${test}\` failed in **${flakes.get(test)}**. ${context}\n`);
}

/**
 * Files each test that a batch's passing browser jobs passed only on a retry, and adds each quarantined test that
 * failed its non-gating run to its issue, naming the batch's PRs: one of them may have broken it.
 */
async function reportRetries(repo, runId, attempt, branch) {
  const jobs = JSON.parse(api(`repos/${repo}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`,
    '[.jobs[] | select(.conclusion == "success" and (.name | startswith("Tests (app-browser"))) | {id, name}]'));
  const flakes = new Map();
  const quarantined = new Map();
  for (const job of jobs) {
    const log = await jobLog(repo, job.id);
    for (const test of parseRetries(log, runId)) flakes.set(test, job.name);
    for (const test of parseRetries(log, runId, 'QUARANTINE FAILED')) quarantined.set(test, job.name);
  }
  const runUrl = `https://github.com/${repo}/actions/runs/${runId}/attempts/${attempt}`;
  await file(repo, flakes, test =>
    `\`${test}\` failed a try in **${flakes.get(test)}** of a Mergify batch and passed on its retry: ${runUrl}\n`);
  if (!quarantined.size) return;
  const draft = JSON.parse(api(`repos/${repo}/pulls?head=${repo.split('/')[0]}:${branch}&state=all`, '[.[0] | {number, body}]'))[0];
  const prs = draft ? batchPullRequests(draft.body, draft.number).map(pr => `#${pr}`).join(', ') : 'its PRs';
  if (process.env.FLAKY_DRY_RUN) return console.log({ quarantineFailed: [...quarantined.keys()], prs });
  // The failure goes on the issue that quarantined the test, which an older issue may name by its bare file name.
  const open = JSON.parse(gh(['issue', 'list', '--repo', repo, '--label', LABEL, '--state', 'open', '--limit', '500',
    '--json', 'number,title,updatedAt,labels'])).map(issue => ({ ...issue, updated_at: issue.updatedAt }));
  const entries = quarantinedTests(open, Date.now());
  const bodyFile = join(tmpdir(), 'flaky-test-quarantine.md');
  for (const [test, job] of quarantined) {
    const entry = quarantineEntry(test, entries);
    if (!entry) continue;
    writeFileSync(bodyFile, `\`${test}\` is quarantined, and ${NON_GATING_FAILURE} in **${job}** of a Mergify batch for ${prs}: ${runUrl}. ` +
      `After ${LIFT_AFTER} such failures in a row, batches run this test again (\`${LIFTED}\`): one of those PRs may have broken it.\n`);
    gh(['issue', 'comment', String(entry.issue), '--repo', repo, '--body-file', bodyFile]);
    const comments = JSON.parse(gh(['issue', 'view', String(entry.issue), '--repo', repo, '--json', 'comments'])).comments;
    if (!shouldLift(comments)) continue;
    gh(['label', 'create', LIFTED, '--repo', repo, '--force', '--color', 'b60205',
      '--description', 'A quarantined test that kept failing its non-gating run: merge-queue batches run it again']);
    gh(['issue', 'edit', String(entry.issue), '--repo', repo, '--add-label', LIFTED]);
  }
}

// The non-gating run already tries each quarantined test three times (VITEST_RETRY=2 in ci.yml), so a flaky test
// rarely fails it; a broken one fails it in every batch.
const NON_GATING_FAILURE = 'failed every try of its non-gating run';
export const LIFT_AFTER = 2;

/**
 * Whether a quarantined test's issue shows LIFT_AFTER non-gating failures in a row: its latest comments, with no
 * other report (a retried flake, a reopen) or anyone's comment since.
 */
export function shouldLift(comments) {
  let streak = 0;
  for (const comment of [...comments].reverse()) {
    if (!comment.body.includes(NON_GATING_FAILURE)) break;
    streak++;
  }
  return streak >= LIFT_AFTER;
}

/**
 * Which issue a flake goes to: the open issue for its test, else the newest closed one, reopened, since the test is
 * flaky again and its history (and whoever fixed it) is there; else a new issue.
 */
export function issueFor(issues, title) {
  const same = issues.filter(issue => issue.title === title).sort((a, b) => a.number - b.number);
  const open = same.find(issue => issue.state === 'OPEN');
  if (open) return { action: 'comment', number: open.number };
  // A raced duplicate was closed as not planned (closeDuplicates), or someone closed one as a duplicate: the original,
  // the oldest, carries the history.
  const closed = same.filter(issue => !['NOT_PLANNED', 'DUPLICATE'].includes(issue.stateReason)).at(-1) ?? same[0];
  return closed ? { action: 'reopen', number: closed.number } : { action: 'create' };
}

// A quarantined test that keeps failing its non-gating run gates batches again: it may be broken rather than flaky, and
// every batch's failure comment would otherwise keep its quarantine from expiring. Reopening the issue takes it off.
export const LIFTED = 'quarantine-lifted';

async function file(repo, flakes, entryOf) {
  if (!flakes.size) return;
  // FLAKY_DRY_RUN=1 lists what it would file, for trying the script on a past run.
  if (process.env.FLAKY_DRY_RUN) return console.log(Object.fromEntries([...flakes.keys()].map(test => [test, entryOf(test)])));

  gh(['label', 'create', LABEL, '--repo', repo, '--force', '--color', 'fbca04',
    '--description', 'A test that failed and then passed on the same code']);
  const issues = JSON.parse(gh(['issue', 'list', '--repo', repo, '--label', LABEL, '--state', 'all', '--limit', '1000',
    '--json', 'number,title,state,stateReason']));
  const bodyFile = join(tmpdir(), 'flaky-test-body.md');
  for (const test of flakes.keys()) {
    const title = issueTitle(test);
    const target = issueFor(issues, title);
    const entry = entryOf(test);
    if (target.action === 'create') {
      writeFileSync(bodyFile, `${entry}\n` +
        'Before fixing it, comment here that you are on it, and link the PR. Later flakes of this test are added here.\n');
      gh(['issue', 'create', '--repo', repo, '--title', title, '--label', LABEL, '--body-file', bodyFile]);
      closeDuplicates(repo, title);
      continue;
    }
    if (target.action === 'reopen') {
      gh(['issue', 'reopen', String(target.number), '--repo', repo]);
      try {
        gh(['issue', 'edit', String(target.number), '--repo', repo, '--remove-label', LIFTED]);
      } catch {}
      // Later flakes in this same report comment on it rather than reopening it again.
      issues.push({ number: target.number, title, state: 'OPEN' });
    }
    writeFileSync(bodyFile, target.action === 'reopen' ? `Flaky again after this issue was closed. ${entry}` : entry);
    gh(['issue', 'comment', String(target.number), '--repo', repo, '--body-file', bodyFile]);
  }
}

export const QUIET_MS = 24 * 3600_000;

/**
 * The open `Flaky test: ` issues, filed by the reporter or by hand, that have been quiet for QUIET_MS: no flake of the
 * test (each one comments) and no one commenting, such as to claim it, since. Assigned issues stay open for their
 * owner; their quarantine still ends after a quiet QUARANTINE_MS (scripts/quarantine.mjs).
 */
export function quietIssues(issues, now) {
  return issues.filter(issue => {
    if (!issue.title.startsWith('Flaky test: ') || issue.assignees?.length) return false;
    const last = Math.max(Date.parse(issue.createdAt), ...(issue.comments ?? []).map(comment => Date.parse(comment.createdAt)));
    return now - last > QUIET_MS;
  });
}

// Closing ends the test's quarantine in merge-queue batches (scripts/test-quarantine.mjs); its next flake reopens the
// issue, which quarantines it again. A test that stays fixed needs no one to come back and close its issue.
function closeQuiet(repo) {
  try {
    const issues = JSON.parse(gh(['issue', 'list', '--repo', repo, '--label', LABEL, '--state', 'open', '--limit', '500',
      '--json', 'number,title,author,assignees,createdAt,comments']));
    for (const issue of quietIssues(issues, Date.now())) {
      console.log(`Closing #${issue.number}, quiet for a day: ${issue.title}`);
      gh(['issue', 'close', String(issue.number), '--repo', repo, '--reason', 'completed', '--comment',
        'No flake of this test in a day, so this closes, and merge-queue batches run the test again. Its next flake reopens this issue.']);
    }
  } catch (error) {
    console.log(`Closing quiet flaky-test issues failed: ${error.message.split('\n')[0]}`);
  }
}

/** The oldest open issue among those with this title; a race between two reports leaves several. */
export function duplicatesOf(issues, title) {
  const same = issues.filter(issue => issue.title === title).sort((a, b) => a.number - b.number);
  return { keep: same[0], close: same.slice(1) };
}

// Two reports of a new flake can both find no issue and both create one. The later one folds into the oldest, so a
// claim always lands on one issue; a lock would instead drop reports, since Actions keeps one pending run per group.
function closeDuplicates(repo, title) {
  const issues = JSON.parse(gh(['issue', 'list', '--repo', repo, '--label', LABEL, '--state', 'open', '--limit', '500',
    '--json', 'number,title']));
  const { keep, close } = duplicatesOf(issues, title);
  for (const issue of close) {
    gh(['issue', 'close', String(issue.number), '--repo', repo, '--reason', 'not planned',
      '--comment', `Duplicate of #${keep.number}, which tracks this test.`]);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
