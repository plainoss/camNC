import assert from 'node:assert/strict';
import { test } from 'node:test';
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
