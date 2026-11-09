const escape = text =>
  String(text).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);

/**
 * A JUnit report of a spec run, for CI's test results. A scenario is a test case in its domain's suite. A known gap that
 * still fails is skipped, a quarantined (FLAKY) failure stays a failure so it counts towards the scenario's flakiness,
 * and a known gap that now passes fails, as it fails the run.
 */
export function junitReport(results) {
  const suites = new Map();
  for (const result of results) {
    const domain = result.id.split('/')[0];
    suites.set(domain, [...(suites.get(domain) ?? []), result]);
  }
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<testsuites name="behaviour specs">'];
  for (const [domain, cases] of suites) {
    const failures = cases.filter(result => ['FAIL', 'FLAKY', 'XPASS'].includes(result.result)).length;
    const skipped = cases.filter(result => result.result === 'XFAIL').length;
    const time = cases.reduce((sum, result) => sum + result.durationMs, 0) / 1000;
    lines.push(`  <testsuite name="${escape(domain)}" tests="${cases.length}" failures="${failures}" skipped="${skipped}" time="${time}">`);
    for (const { id, result, failures: messages, durationMs } of cases) {
      const open = `    <testcase classname="${escape(domain)}" name="${escape(id)}" time="${durationMs / 1000}"`;
      if (result === 'PASS') lines.push(`${open}/>`);
      else if (result === 'XFAIL') lines.push(`${open}><skipped message="known gap"/></testcase>`);
      else {
        const message = result === 'XPASS' ? 'known gap now passes' : messages[0] ?? result;
        lines.push(`${open}><failure message="${escape(message)}">${escape(messages.join('\n'))}</failure></testcase>`);
      }
    }
    lines.push('  </testsuite>');
  }
  lines.push('</testsuites>', '');
  return lines.join('\n');
}
