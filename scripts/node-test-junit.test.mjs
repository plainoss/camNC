import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupLooseTestCases } from './node-test-junit.mjs';

test('wraps runs of loose top-level test cases in a suite and keeps describe() suites', () => {
  const xml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<testsuites>',
    '\t<testcase name="passes" time="0.5" classname="test"/>',
    '\t<testcase name="fails" time="0.25" classname="test" failure="no">',
    '\t\t<failure type="testCodeFailure" message="no">',
    '\tstack line',
    '\t\t</failure>',
    '\t</testcase>',
    '\t<testsuite name="group" tests="1">',
    '\t\t<testcase name="inner" time="0.1" classname="test"/>',
    '\t</testsuite>',
    '\t<testcase name="skipped" time="0" classname="test">',
    '\t\t<skipped type="skipped" message="true"/>',
    '\t</testcase>',
    '\t<!-- tests 4 -->',
    '</testsuites>',
  ].join('\n');
  assert.equal(groupLooseTestCases(xml, 'ci'), [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<testsuites>',
    '\t<testsuite name="ci" tests="2" failures="1" skipped="0" time="0.75">',
    '\t\t<testcase name="passes" time="0.5" classname="test"/>',
    '\t\t<testcase name="fails" time="0.25" classname="test" failure="no">',
    '\t\t\t<failure type="testCodeFailure" message="no">',
    '\t\tstack line',
    '\t\t\t</failure>',
    '\t\t</testcase>',
    '\t</testsuite>',
    '\t<testsuite name="group" tests="1">',
    '\t\t<testcase name="inner" time="0.1" classname="test"/>',
    '\t</testsuite>',
    '\t<testsuite name="ci" tests="1" failures="0" skipped="1" time="0">',
    '\t\t<testcase name="skipped" time="0" classname="test">',
    '\t\t\t<skipped type="skipped" message="true"/>',
    '\t\t</testcase>',
    '\t</testsuite>',
    '\t<!-- tests 4 -->',
    '</testsuites>',
  ].join('\n'));
});
