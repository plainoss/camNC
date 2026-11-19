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
  // A dimension's pick is the edge and then where its label goes: a second pick in the same step.
  pick: { steps: ['viewpick', 'click'], then: ['viewpick', 'click'] },
  // A context menu is two selects: `featuremenu` (the right-click) and `menuitem` (the choice).
  // Double-clicking a row (`feature`) or a dimension label (`editdim`) selects it, and so does a dialog's choice list.
  select: {
    // `key Enter` takes the highlighted choice of a field's list, such as New variable.
    steps: ['selectpart', 'selectfeature', 'feature', 'featureeye', 'featuremenu', 'partmenu', 'menuitem', 'patterncount', 'patternspacing', 'dialogfocus', 'dialogtab', 'dialogselect', 'editdim', 'click', 'shiftclick', 'drag', 'panelclose', 'featurefilter', 'viewmenu', 'dialogoption', 'key Enter'],
    // "Select A, then (Shift-click) B" is one step: each shift-click adds to what the first input selected.
    then: ['shiftclick'],
  },
  command: { steps: ['studiotool', 'searchtool', 'key', 'tool'] },
  draw: { steps: ['rect', 'circle', 'line', 'arc'] },
  // A value typed into a box a chip or dimension opened: double-click it, type, and Enter (or Tab, moving on).
  // A part taken out of a selection box with its chip's cross is a field's input too.
  // A dimension's value is typed into the box double-clicking its label (`editdim`) opens.
  field: {
    steps: ['dialogfill', 'dialogselect', 'dialogcheck', 'dialogtab', 'dialogremove', 'featurefilter', 'field', 'type', 'patterncount', 'patternspacing', 'editdim'],
    then: ['field', 'type', 'key Enter', 'key Tab'],
  },
  // A dialog's own accept button, as a panel's "+" that saves what's typed, is pressed with `dialogfocus`.
  confirm: { steps: ['dialogconfirm', 'closesketch', 'dialogfocus', 'key Enter'] },
  // Escape, then zoom to fit (F) to look at what's drawn.
  cancel: { steps: ['dialogcancel', 'key Escape'], then: ['key f', 'fitview'] },
  // Zooming the drawing to show what's drawn next, and reopening the page, are what a person does to look.
  view: { steps: ['view', 'reload', ...VIEW_KEYS.map(key => `key ${key}`)] },
};

/** Steps that look or record without being an input a person makes. */
// Zooming the drawing to show what's drawn next is looking, not an input of the spec's.
const FREE = new Set(['frame', 'shot', 'checkpoint', 'exportstep', 'savedesign', 'state', 'labelclear', 'fitview']);

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
    // What may follow comes in order, each at most once: a field's value typed, then Enter.
    let next = 0;
    const extra = rest.filter(step => {
      while (next < then.length && !matches(step, [then[next]])) next++;
      return next++ >= then.length;
    });
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
