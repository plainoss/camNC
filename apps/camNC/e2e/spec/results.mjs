/**
 * A scenario's result. `known` marks a gap that must still fail, so a fix can't go unrecorded. `flaky` names the issue
 * of a scenario that fails only sometimes on a busy runner: its failures are reported as FLAKY and don't fail the run,
 * so one race doesn't block every PR while the issue is open, and a pass stays a plain PASS.
 */
export function scenarioResult(scenario, failures) {
  if (failures.length) return scenario.known ? 'XFAIL' : scenario.flaky ? 'FLAKY' : 'FAIL';
  return scenario.known ? 'XPASS' : 'PASS';
}

export const failsRun = counts => Boolean(counts.FAIL || counts.XPASS);
