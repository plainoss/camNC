import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { createAdapter, unsupported } from './adapters/sketch.headless.mjs';
import { scenarioResult } from './results.mjs';

// Sketch scenarios that need no page run here in milliseconds, against the editor's own drawing code. The browser run
// (`spec:cad`) still runs every scenario, so a difference between the two shows up as a failure in one of them.
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'scenarios', 'sketch');
const scenarios = [];
for (const file of (await readdir(dir)).filter(name => name.endsWith('.json')).sort())
  scenarios.push(...JSON.parse(await readFile(path.join(dir, file), 'utf8')));
const headless = scenarios.filter(scenario => !unsupported(scenario) && !scenario.steps.some(step => typeof step === 'string' && step.startsWith('frame ')));

async function run(scenario) {
  const adapter = createAdapter();
  const failures = [];
  for (const [index, step] of scenario.steps.entries()) {
    if (typeof step === 'object') failures.push(...(await adapter.check(step.expect)).map(failure => `step ${index + 1}: ${failure}`));
    else await adapter.step(step);
  }
  return failures;
}

describe('sketch scenarios without a browser', () => {
  test('cover the rectangle scenarios', () => {
    expect(headless.map(scenario => scenario.id)).toEqual(expect.arrayContaining(['sketch/draw/drag-rectangle', 'sketch/draw/rectangle-joins-corner', 'sketch/draw/center-rectangle']));
  });

  test.each(headless.map(scenario => [scenario.id, scenario]))('%s', async (_, scenario) => {
    const failures = await run(scenario);
    const result = scenarioResult(scenario, failures);
    // A known gap must still fail, as in the browser run; a quarantined race can't happen without a page.
    expect({ result, failures }).toEqual({ result: scenario.known ? 'XFAIL' : 'PASS', failures: scenario.known ? failures : [] });
  });
});
