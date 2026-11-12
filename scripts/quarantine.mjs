// The quarantine list and its matching, kept free of Node imports: apps/camNC/src/test/quarantine.ts imports it into
// the browser. scripts/test-quarantine.mjs fetches the list.

const PREFIX = 'Flaky test: ';
// issueTitle in scripts/flaky-tests.mjs cuts titles over 200 characters to 197 and adds this.
const CUT = '...';

/** The tests open flaky-test issues name, as {test, issue, prefix}: `prefix` when the title was cut short. */
export function quarantinedTests(issues) {
  return issues
    .filter(issue => issue.title.startsWith(PREFIX) && !issue.pull_request)
    .map(issue => {
      const name = issue.title.slice(PREFIX.length);
      const cut = issue.title.length === 200 && name.endsWith(CUT);
      return { test: cut ? name.slice(0, -CUT.length) : name, issue: issue.number, prefix: cut };
    });
}

/**
 * The quarantine entry for a test, by its `file > describe > test` name. Older issues name the file without its
 * directories (`CadEditor.studio.test.tsx > …`), so a name ending in `/<entry>` matches too.
 */
export function quarantineEntry(fullName, entries) {
  return entries.find(({ test, prefix }) => {
    const same = name => (prefix ? name.startsWith(test) : name === test);
    if (same(fullName)) return true;
    const slash = fullName.indexOf('/' + test.split(' > ')[0]);
    return slash >= 0 && same(fullName.slice(slash + 1));
  });
}
