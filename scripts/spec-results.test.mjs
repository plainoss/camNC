import assert from 'node:assert/strict';
import { test } from 'node:test';
import { junitReport } from '../apps/camNC/e2e/spec/junit.mjs';
import { failsRun, scenarioResult } from '../apps/camNC/e2e/spec/results.mjs';

test('a quarantined scenario reports its failures without failing the run, and a known gap must still fail', () => {
  const failed = ['entitiesInclude: wanted a circle'];
  assert.equal(scenarioResult({}, failed), 'FAIL');
  assert.equal(scenarioResult({}, []), 'PASS');
  assert.equal(scenarioResult({ flaky: '#291' }, failed), 'FLAKY');
  assert.equal(scenarioResult({ flaky: '#291' }, []), 'PASS');
  assert.equal(scenarioResult({ known: 'gap' }, failed), 'XFAIL');
  assert.equal(scenarioResult({ known: 'gap' }, []), 'XPASS');
  assert.equal(failsRun({ PASS: 3, FLAKY: 1, XFAIL: 1, FAIL: 0, XPASS: 0 }), false);
  assert.equal(failsRun({ FAIL: 1 }), true);
  assert.equal(failsRun({ XPASS: 1 }), true);
});

test('the JUnit report skips known gaps and fails quarantined failures and newly passing gaps', () => {
  const report = junitReport([
    { id: 'sketch/a', result: 'PASS', failures: [], durationMs: 1500 },
    { id: 'sketch/b', result: 'FLAKY', failures: ['wanted <circle> & got none'], durationMs: 500 },
    { id: 'cam/c', result: 'XFAIL', failures: ['gap'], durationMs: 100 },
    { id: 'cam/d', result: 'XPASS', failures: [], durationMs: 100 },
  ]);
  assert.match(report, /<testsuite name="sketch" tests="2" failures="1" skipped="0" time="2">/);
  assert.match(report, /<testcase classname="sketch" name="sketch\/a" time="1.5"\/>/);
  assert.match(report, /<failure message="wanted &lt;circle&gt; &amp; got none">/);
  assert.match(report, /<testsuite name="cam" tests="2" failures="1" skipped="1"/);
  assert.match(report, /name="cam\/c" time="0.1"><skipped message="known gap"\/>/);
  assert.match(report, /name="cam\/d" time="0.1"><failure message="known gap now passes">/);
});
