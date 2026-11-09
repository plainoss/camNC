#!/usr/bin/env node
// Node's junit reporter writes a top-level `test()` as a <testcase> directly under <testsuites>, with no <testsuite>
// around it. Mergify's parser rejects such a report ("no testsuites or testsuite tag found"), so CI rewrites it in place
// before the upload: each run of loose top-level test cases goes into one <testsuite>. Suites from `describe()` stay.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The report with every run of loose top-level <testcase> elements wrapped in a <testsuite name={name}>. */
export function groupLooseTestCases(xml, name) {
  // The reporter writes one element per line, indented by depth, so a top-level child starts with exactly one tab.
  const lines = xml.split('\n');
  const out = [];
  let loose = [];
  let counts = { tests: 0, failures: 0, skipped: 0, time: 0 };
  const flush = () => {
    if (!loose.length) return;
    const { tests, failures, skipped, time } = counts;
    out.push(`\t<testsuite name="${name}" tests="${tests}" failures="${failures}" skipped="${skipped}" time="${time}">`);
    out.push(...loose.map(line => `\t${line}`));
    out.push('\t</testsuite>');
    loose = [];
    counts = { tests: 0, failures: 0, skipped: 0, time: 0 };
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^\t<testcase\b/.test(line)) {
      // Comments and existing suites sit between runs of loose cases, so they end the current run.
      if (/^\t</.test(line) || /^<\/testsuites>/.test(line)) flush();
      out.push(line);
      continue;
    }
    const block = [line];
    if (!/\/>\s*$/.test(line)) {
      while (i + 1 < lines.length && !/^\t<\/testcase>/.test(lines[i])) block.push(lines[++i]);
    }
    counts.tests++;
    counts.time += Number(/\btime="([^"]*)"/.exec(line)?.[1] ?? 0);
    if (block.some(part => /<failure\b/.test(part))) counts.failures++;
    if (block.some(part => /<skipped\b/.test(part))) counts.skipped++;
    loose.push(...block);
  }
  flush();
  return out.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const file of process.argv.slice(2)) {
    writeFileSync(file, groupLooseTestCases(readFileSync(file, 'utf8'), basename(file, '.xml')));
  }
}
