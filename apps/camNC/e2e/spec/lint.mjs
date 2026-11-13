import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * "No extra inputs": a scenario written from a step-by-step spec marks each spec step with `{ "spec": "<n> <kind>" }`
 * before the camNC input that does it. Each kind allows exactly one input of the listed steps. Checks are free.
 */
/** The 3D view's own shortcuts: fit (F), normal to the picked plane or face (N), and the named views Shift+1…7. */
export const VIEW_KEYS = ['f', 'F', 'n', 'N', ...[1, 2, 3, 4, 5, 6, 7].flatMap(digit => [`Shift+${digit}`, `Shift+Digit${digit}`])];

export const ALLOWED = {
  // `click x,y` is a pick on an open sketch's drawing, as `viewpick` is there.
  pick: { steps: ['viewpick', 'click'] },
  select: { steps: ['selectpart', 'selectfeature', 'click'] },
  command: { steps: ['studiotool', 'key', 'tool'] },
  draw: { steps: ['rect', 'circle', 'line', 'arc'] },
  field: { steps: ['dialogfill', 'dialogselect', 'dialogcheck', 'field'], then: ['key Enter'] },
  confirm: { steps: ['dialogconfirm', 'closesketch', 'key Enter'] },
  cancel: { steps: ['dialogcancel', 'key Escape'] },
  view: { steps: ['view', ...VIEW_KEYS.map(key => `key ${key}`)] },
};

/** Steps that look or record without being an input a person makes. */
const FREE = new Set(['frame', 'shot', 'checkpoint', 'exportstep', 'savedesign', 'state']);

const verbOf = step => step.trim().split(/\s+/, 1)[0];
const matches = (step, allowed) => allowed.some(entry => (entry.includes(' ') ? step.trim() === entry : verbOf(step) === entry));

/** The marker's number and kind, or an error message. */
export function parseMarker(marker) {
  const match = /^(\d+)\s+([a-z]+)$/.exec(String(marker).trim());
  if (!match) return { error: `spec marker must be "<n> <kind>": ${JSON.stringify(marker)}` };
  if (!ALLOWED[match[2]]) return { error: `unknown spec step kind "${match[2]}"; use one of ${Object.keys(ALLOWED).join(', ')}` };
  return { n: Number(match[1]), kind: match[2] };
}

/** Findings for one scenario: every spec step whose inputs are not exactly one allowed input. */
export function lintScenario(scenario) {
  const findings = [], setup = [], groups = [];
  let current = null;
  for (const step of scenario.steps ?? []) {
    if (step && typeof step === 'object' && 'spec' in step) {
      const marker = parseMarker(step.spec);
      if (marker.error) findings.push({ spec: String(step.spec), problem: marker.error });
      else if (groups.length && marker.n <= groups.at(-1).n) findings.push({ spec: String(step.spec), problem: `spec step ${marker.n} comes after step ${groups.at(-1).n}` });
      current = marker.error ? null : { ...marker, inputs: [] };
      if (current) groups.push(current);
      continue;
    }
    if (typeof step !== 'string' || FREE.has(verbOf(step))) continue;
    if (current) current.inputs.push(step);
    else setup.push(step);
  }
  for (const { n, kind, inputs } of groups) {
    const { steps, then = [] } = ALLOWED[kind];
    const [first, ...rest] = inputs;
    const extra = rest.filter((step, index) => !(index === 0 && matches(step, then)));
    if (!first) findings.push({ spec: `${n} ${kind}`, problem: 'no input', allowed: steps });
    else if (!matches(first, steps) || extra.length)
      findings.push({ spec: `${n} ${kind}`, problem: !matches(first, steps) ? 'input not allowed for this kind' : `${extra.length} extra input${extra.length > 1 ? 's' : ''}`, allowed: steps, inputs });
  }
  if (!groups.length) findings.push({ spec: null, problem: 'no spec markers' });
  return { id: scenario.id, ok: !findings.length, steps: groups.length, setup, findings };
}

export function lintScenarios(list) {
  const scenarios = list.map(lintScenario);
  return { ok: scenarios.every(scenario => scenario.ok), scenarios };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2).filter(arg => arg !== '--');
  if (!files.length) {
    console.error('Usage: spec:lint <scenario.json> ...');
    process.exit(2);
  }
  let ok = true;
  for (const file of files) {
    const resolved = path.resolve(process.env.INIT_CWD ?? process.cwd(), file);
    const result = { file: resolved, ...lintScenarios(JSON.parse(await readFile(resolved, 'utf8'))) };
    ok &&= result.ok;
    console.log(JSON.stringify(result));
  }
  process.exitCode = ok ? 0 : 1;
}
