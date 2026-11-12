#!/usr/bin/env node
// Quarantine: in merge-queue batches, a browser test with an open `flaky-test` issue is skipped, so a test that flaked
// once can't eject batches while its fix is pending. The issue is the quarantine record: scripts/flaky-tests.mjs opens
// (or reopens) it on the test's first flake, and closing it, when the fix lands, ends the quarantine. PR, `full-ci` and
// scheduled runs still run every test, so the fix and Mergify's flaky detection see it.
// Run in CI, this prints `VITEST_QUARANTINE=<json>` for $GITHUB_ENV; apps/camNC/vitest.config.ts hands the list to
// src/test/quarantine.ts.
import { pathToFileURL } from 'node:url';

import { quarantinedTests } from './quarantine.mjs';

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const issues = [];
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(`https://api.github.com/repos/${repo}/issues?labels=flaky-test&state=open&per_page=100&page=${page}`, {
      headers: { authorization: `Bearer ${process.env.GH_TOKEN}`, accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(`flaky-test issues: HTTP ${res.status}`);
    const batch = await res.json();
    issues.push(...batch);
    if (batch.length < 100) break;
  }
  const entries = quarantinedTests(issues);
  console.error(`Quarantined in this batch: ${entries.length ? entries.map(e => `\n  #${e.issue} ${e.test}`).join('') : 'none'}`);
  console.log(`VITEST_QUARANTINE=${JSON.stringify(entries)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
