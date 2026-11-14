/**
 * The Part Studio's lists as a person sees them: the Feature list's rows in order with their visible state, and the
 * Parts list's rows. A row's state is what the list shows for it: suppressed, hidden, rolled back (below the rollback
 * bar) or an error.
 */

/** The Feature list's rows, below its default geometry, in order. */
export async function readFeatures(page) {
  const list = page.getByRole('region', { name: 'Features', exact: true }).locator('ol').first();
  if (!(await list.count())) return null;
  return list.evaluate(element =>
    [...element.children].filter(item => item.tagName === 'LI').map(item => {
      const button = item.querySelector(':scope > button');
      const name = [...(button?.querySelectorAll(':scope > span:not([aria-hidden])') ?? [])].find(span => !span.getAttribute('role'))?.textContent?.trim() ?? null;
      // The row's state shows as its styling, its eye and its warning; these are the classes that draw it.
      const state = [];
      if (item.classList.contains('cad-feature-suppressed')) state.push('suppressed');
      if (item.classList.contains('cad-feature-hidden') || item.querySelector(':scope > button[aria-label="Show"]')) state.push('hidden');
      if (item.classList.contains('cad-feature-rolled-back')) state.push('rolled back');
      if (item.classList.contains('cad-feature-broken') || button?.querySelector('[role=img][aria-label="Error"]')) state.push('error');
      return { name, ...(item.classList.contains('cad-folder-row') && { folder: true }), state };
    })
  );
}

/** The Parts list's rows in order, each with whether its eye hides it. */
export async function readParts(page) {
  const list = page.getByRole('list', { name: 'Parts', exact: true });
  if (!(await list.count())) return null;
  return list.getByRole('listitem').evaluateAll(items =>
    items.flatMap(item => {
      const button = item.querySelector(':scope > button:not(.cad-part-eye)');
      const name = button?.querySelector('span:not([aria-hidden]):not([role])')?.textContent?.trim();
      if (!name) return [];
      // The eye is named for what it does: "Show <name>" on a hidden row.
      const eye = [...item.querySelectorAll(':scope > button')].find(candidate => /^(Show|Hide) /.test(candidate.getAttribute('aria-label') ?? ''));
      return [{ name, hidden: eye?.getAttribute('aria-label') === `Show ${name}` }];
    })
  );
}

const rowOf = wanted => (typeof wanted === 'string' ? { name: wanted } : wanted);

/**
 * Compares list rows in order. A wanted row is a name, or `{ name, state }` / `{ name, hidden }`; only the fields it
 * gives are compared, but the row count and every name must match, so an extra or missing row fails.
 */
export function checkRows(label, wanted, actual) {
  if (!Array.isArray(actual)) return [`studio/${label}: wanted ${wanted.length} rows, got no list`];
  const failures = [];
  const names = rows => rows.map(row => rowOf(row).name);
  if (JSON.stringify(names(wanted)) !== JSON.stringify(names(actual)))
    failures.push(`studio/${label}: wanted rows ${JSON.stringify(names(wanted))}, got ${JSON.stringify(names(actual))}`);
  else
    for (const [index, row] of wanted.map(rowOf).entries()) {
      const got = actual[index];
      if (row.state && JSON.stringify([...row.state].sort()) !== JSON.stringify([...got.state].sort()))
        failures.push(`studio/${label}/${row.name}/state: wanted ${JSON.stringify(row.state)}, got ${JSON.stringify(got.state)}`);
      if ('hidden' in row && row.hidden !== got.hidden) failures.push(`studio/${label}/${row.name}/hidden: wanted ${row.hidden}, got ${got.hidden}`);
    }
  return failures;
}
