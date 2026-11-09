#!/usr/bin/env node
// Files a `flaky-test` issue for each test that failed in a CI run but passed on the same code: a merge-queue failure
// whose PR passed, or a failed attempt that a rerun fixed. Each later flake comments on the open issue for that test,
// so every session sees who already owns it before patching the same failure into its own branch.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const LABEL = 'flaky-test';

/** The failed tests in a job log: behaviour spec scenarios and Vitest tests, each once. */
export function parseFailures(log) {
  const failures = new Set();
  for (const raw of log.split('\n')) {
    // Drop the runner's timestamp and colours.
    const line = raw.replace(/\x1b\[[0-9;]*m/g, '').replace(/^\S+Z /, '').trimEnd();
    // Turbo prefixes each line with its task; a direct `pnpm vitest run` step, such as the simulator tests, does not.
    const match = /^(?:@[^\s:]+:[^\s]+:)?\s*FAIL\s+(?:chromium\s+)?(.+)$/.exec(line);
    if (match) failures.add(match[1].trim());
  }
  return [...failures];
}

export const MERGIFY_BATCH = 'mergify/merge-queue/';

/**
 * Which attempt to read, or null when the run says nothing about flakiness. A failed Mergify batch is judged later,
 * when a batch with the same PR commits passes (see `coveredBy`), since PR runs skip the browser suites and specs.
 */
export function attemptToRead({ event, conclusion, attempt, branch = '' }) {
  if (event === 'merge_group' && conclusion === 'failure') return attempt;
  if (conclusion === 'success' && attempt > 1) return attempt - 1;
  return null;
}

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

  const attempt = attemptToRead(run);
  if (attempt === null) return;
  const runUrl = `https://github.com/${repo}/actions/runs/${run.id}/attempts/${attempt}`;
  if (run.event !== 'merge_group') return report(repo, run.id, attempt, `A rerun of the same commit passed: ${runUrl}`);
  const pr = /^gh-readonly-queue\/[^/]+\/pr-(\d+)-/.exec(run.branch)?.[1];
  if (!pr) return;
  // Only jobs that passed on the PR's own run count: PR runs skip the browser suites and specs unless labelled `full-ci`.
  const head = api(`repos/${repo}/pulls/${pr}`, '.head.sha');
  const own = JSON.parse(api(`repos/${repo}/actions/runs?head_sha=${head}&event=pull_request`,
    '[.workflow_runs[] | select(.name == "CI" and .conclusion == "success") | .id]'));
  const passedJobs = new Set(own.flatMap(id =>
    JSON.parse(api(`repos/${repo}/actions/runs/${id}/jobs?per_page=100`, '[.jobs[] | select(.conclusion == "success") | .name]'))));
  await report(repo, run.id, attempt,
    `The merge queue failed ${runUrl} for #${pr}, whose own PR run passed the same job. It can also be an interaction with a PR ahead in the queue.`,
    job => passedJobs.has(job));
}

async function report(repo, runId, attempt, context, includeJob = () => true) {
  const jobs = JSON.parse(api(`repos/${repo}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`,
    '[.jobs[] | select(.conclusion == "failure" and .name != "Run tests") | {id, name}]'));
  const flakes = new Map();
  for (const job of jobs.filter(job => includeJob(job.name))) {
    const tests = parseFailures(await jobLog(repo, job.id));
    // A job that hung or failed outside a test still gets one issue, under its own name.
    for (const test of tests.length ? tests : [`${job.name} (no failing test in its log)`]) flakes.set(test, job.name);
  }
  if (!flakes.size) return;
  // FLAKY_DRY_RUN=1 lists what it would file, for trying the script on a past run.
  if (process.env.FLAKY_DRY_RUN) return console.log(context, Object.fromEntries(flakes));

  gh(['label', 'create', LABEL, '--repo', repo, '--force', '--color', 'fbca04',
    '--description', 'A test that failed and then passed on the same code']);
  const open = JSON.parse(gh(['issue', 'list', '--repo', repo, '--label', LABEL, '--state', 'open', '--limit', '500',
    '--json', 'number,title']));
  const bodyFile = join(tmpdir(), 'flaky-test-body.md');
  for (const [test, job] of flakes) {
    const title = issueTitle(test);
    const existing = open.find(issue => issue.title === title);
    const entry = `\`${test}\` failed in **${job}**. ${context}\n`;
    writeFileSync(bodyFile, existing ? entry : `${entry}\n` +
      'Before fixing it, comment here that you are on it, and link the PR. Later flakes of this test are added here.\n');
    if (existing) gh(['issue', 'comment', String(existing.number), '--repo', repo, '--body-file', bodyFile]);
    else {
      gh(['issue', 'create', '--repo', repo, '--title', title, '--label', LABEL, '--body-file', bodyFile]);
      closeDuplicates(repo, title);
    }
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
