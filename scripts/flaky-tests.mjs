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

/** Which attempt to read, or null when the run says nothing about flakiness. */
export function attemptToRead({ event, conclusion, attempt }) {
  if (event === 'merge_group' && conclusion === 'failure') return attempt;
  if (conclusion === 'success' && attempt > 1) return attempt - 1;
  return null;
}

export function issueTitle(test) {
  const title = `Flaky test: ${test}`;
  return title.length > 200 ? `${title.slice(0, 197)}...` : title;
}

const gh = (args, input) => execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
const api = (path, jq) => gh(['api', path, ...(jq ? ['--jq', jq] : [])]).trim();

function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const run = { id: process.env.RUN_ID, event: process.env.RUN_EVENT, conclusion: process.env.RUN_CONCLUSION };
  run.attempt = Number(process.env.RUN_ATTEMPT);
  const attempt = attemptToRead(run);
  if (attempt === null) return;
  const runUrl = `https://github.com/${repo}/actions/runs/${run.id}/attempts/${attempt}`;
  let context = `A rerun of the same commit passed: ${runUrl}`;

  if (run.event === 'merge_group') {
    const pr = /^gh-readonly-queue\/[^/]+\/pr-(\d+)-/.exec(process.env.RUN_BRANCH ?? '')?.[1];
    if (!pr) return;
    const head = api(`repos/${repo}/pulls/${pr}`, '.head.sha');
    const passed = api(`repos/${repo}/actions/runs?head_sha=${head}&event=pull_request`,
      `[.workflow_runs[] | select(.name == "CI" and .conclusion == "success")] | length`);
    // A PR that never passed failed for its own reasons.
    if (passed === '0') return;
    context = `The merge queue failed ${runUrl} for #${pr}, whose PR checks passed. It can also be an interaction with a PR ahead in the queue.`;
  }

  const jobs = JSON.parse(api(`repos/${repo}/actions/runs/${run.id}/attempts/${attempt}/jobs?per_page=100`,
    '[.jobs[] | select(.conclusion == "failure" and .name != "Run tests") | {id, name}]'));
  const flakes = new Map();
  for (const job of jobs) {
    const tests = parseFailures(gh(['api', `repos/${repo}/actions/jobs/${job.id}/logs`]));
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
    const report = `\`${test}\` failed in **${job}**. ${context}\n`;
    writeFileSync(bodyFile, existing ? report : `${report}\n` +
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

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
