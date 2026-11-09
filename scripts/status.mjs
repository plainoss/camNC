#!/usr/bin/env node
// Generates docs/STATUS.md from committed sources, and checks that the committed copy is current. Nothing in STATUS.md
// is written by hand:
//
//   - spec results per domain, from the behaviour scenarios and their `known` / `flaky` markers (no browser needed: a
//     run fails on FAIL and XPASS, so a scenario without `known` must pass and one with it must still fail);
//   - the feature checklist in docs/status-checklist.json, whose evidence must name a spec ID or a file that exists;
//   - the performance gates and their budgets, found the way the "Performance gates" CI step finds them: the root
//     `test:performance` script, each package's `test:performance` configs, their files and `[performance]` tests;
//   - the floors in scripts/status-floors.json. A domain's passing specs may only go up: the check fails when a count
//     drops below its floor, and when it rises above it, so the floor follows. `--write` raises floors to the counts
//     and adds new domains. Nothing here lowers a floor.
//
//   node scripts/status.mjs           check: evidence, floors, and that docs/STATUS.md matches what would be generated
//   node scripts/status.mjs --write   raise floors and rewrite docs/STATUS.md (refuses while a floor is broken)
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STATUS_FILE = 'docs/STATUS.md';
export const CHECKLIST_FILE = 'docs/status-checklist.json';
export const FLOORS_FILE = 'scripts/status-floors.json';
export const SCENARIOS_DIR = 'apps/camNC/e2e/spec/scenarios';

const regenerate = 'Run `pnpm run status` and commit the result.';

const readJson = (root, file) => JSON.parse(readFileSync(resolve(root, file), 'utf8'));

/** Every behaviour scenario, as run.mjs loads them: one folder per domain, JSON lists of scenarios. */
export function loadScenarios(root) {
  const base = resolve(root, SCENARIOS_DIR);
  const scenarios = [];
  for (const domain of readdirSync(base).sort()) {
    if (!statSync(join(base, domain)).isDirectory()) continue;
    for (const file of readdirSync(join(base, domain))
      .filter(name => name.endsWith('.json'))
      .sort()) {
      for (const scenario of JSON.parse(readFileSync(join(base, domain, file), 'utf8'))) scenarios.push({ ...scenario, domain });
    }
  }
  return scenarios;
}

/**
 * Counts per domain, and per group (the first two parts of an ID) within it. PASS is every scenario expected to pass,
 * which includes quarantined ones: they still run, and a quarantine shouldn't need its floor lowered. XFAIL is a known
 * gap, FLAKY a quarantined scenario.
 */
export function specCounts(scenarios) {
  const counts = {};
  const add = (into, scenario) => {
    into.total++;
    if (scenario.known) into.xfail++;
    else into.pass++;
    if (scenario.flaky) into.flaky++;
  };
  const empty = () => ({ total: 0, pass: 0, xfail: 0, flaky: 0 });
  for (const scenario of scenarios) {
    const domain = (counts[scenario.domain] ??= { ...empty(), groups: {} });
    add(domain, scenario);
    add((domain.groups[scenario.id.split('/').slice(0, 2).join('/')] ??= empty()), scenario);
  }
  return counts;
}

/**
 * Checks passing counts against floors.
 * @returns {{ errors: string[], floors: Record<string, number> }} errors for counts below or above their floor, and
 * the floors `--write` would save: raised to the counts, never lowered, with new domains added
 */
export function checkFloors(counts, floors) {
  const errors = [];
  const next = { ...floors };
  for (const [domain, floor] of Object.entries(floors)) {
    const pass = counts[domain]?.pass ?? 0;
    if (pass < floor)
      errors.push(
        `${domain} has ${pass} passing specs, below its floor of ${floor} in ${FLOORS_FILE}. Passing specs may only go up: fix or restore the specs instead of lowering the floor.`
      );
  }
  for (const [domain, { pass }] of Object.entries(counts)) {
    const floor = floors[domain];
    if (floor === undefined || pass > floor) {
      errors.push(
        floor === undefined
          ? `${domain} has ${pass} passing specs and no floor in ${FLOORS_FILE}. ${regenerate}`
          : `${domain} has ${pass} passing specs, above its floor of ${floor}: raise the floor. ${regenerate}`
      );
      next[domain] = pass;
    }
  }
  return { errors, floors: Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b))) };
}

/** Checks the checklist's shape and that every piece of evidence is a scenario ID or an existing file. */
export function checkChecklist(checklist, { specIds, fileExists }) {
  const errors = [];
  const statuses = Object.keys(checklist.statuses ?? {});
  for (const area of checklist.areas ?? []) {
    for (const row of area.rows ?? []) {
      const where = `${CHECKLIST_FILE}: ${area.name} > ${row.item}`;
      if (!statuses.includes(row.status)) errors.push(`${where} has status ${row.status}, not one of ${statuses.join(', ')}.`);
      const evidence = row.evidence ?? [];
      if (row.status !== 'gap' && evidence.length === 0) errors.push(`${where} needs evidence: a spec ID or a test file.`);
      if (row.status === 'gap' && evidence.length === 0 && !row.note) errors.push(`${where} is a gap with no evidence, so it needs a note.`);
      for (const item of evidence) {
        if (specIds.has(item)) continue;
        if (item.includes('..') || item.startsWith('/') || !fileExists(item))
          errors.push(`${where}: evidence ${item} is neither a spec ID in ${SCENARIOS_DIR} nor a file in the repository.`);
      }
    }
  }
  return errors;
}

function packageDirs(root) {
  const dirs = {};
  for (const parent of ['apps', 'packages']) {
    for (const name of readdirSync(resolve(root, parent))) {
      const file = resolve(root, parent, name, 'package.json');
      if (existsSync(file)) dirs[JSON.parse(readFileSync(file, 'utf8')).name] = `${parent}/${name}`;
    }
  }
  return dirs;
}

/** The text from `start` to the matching close of the brace or parenthesis opened at or after it. */
function balanced(text, start) {
  const open = text.slice(start).search(/[({]/) + start;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(' || text[i] === '{') depth++;
    else if (text[i] === ')' || text[i] === '}') if (--depth === 0) return text.slice(open, i + 1);
  }
  return text.slice(open);
}

/** The first `expect(...).toBeLessThan(...)` in a test body, or in a helper of the same file that it calls. */
function findBudget(text, body) {
  const direct = /expect\((.*)\)\.toBeLessThan\(([^)]+)\)/.exec(body);
  if (direct) return direct;
  for (const [, name] of body.matchAll(/\b(\w+)\(/g)) {
    const at = text.search(new RegExp(`function ${name}\\b`));
    if (at < 0) continue;
    const found = /expect\((.*)\)\.toBeLessThan\(([^)]+)\)/.exec(balanced(text, text.indexOf('{', at)));
    if (found) return found;
  }
  return null;
}

/** The `[performance]` tests of one test file with their budgets. */
export function gatesInFile(text, namePattern) {
  const gates = [];
  const tests = /\b(?:it|test)(?:\.each\(([^\n]*?)\))?\(\s*(['"`])(.*?)\2/g;
  for (const match of text.matchAll(tests)) {
    const [, cases, , title] = match;
    if (!namePattern.test(title)) continue;
    // The call's own parenthesis: back from the title's opening quote, over any whitespace.
    let open = match.index + match[0].length - title.length - 2;
    while (text[open] !== '(') open--;
    const found = findBudget(text, balanced(text, open));
    if (!found) throw new Error(`No expect(...).toBeLessThan(...) found for performance test "${title}"`);
    const [, measure, limit] = found;
    const constant = /^\d/.test(limit) ? null : new RegExp(`const ${limit}\\s*=\\s*([\\d.]+)`).exec(text);
    if (!/^\d/.test(limit) && !constant) throw new Error(`Budget ${limit} of "${title}" is not a numeric constant`);
    const unit = /ratio/i.test(measure) ? '× reference work' : 'ms';
    gates.push({ title: title.replace(namePattern, '').trim(), cases: cases ?? null, budget: `< ${constant ? constant[1] : limit} ${unit}` });
  }
  return gates;
}

/** The performance gates the root `test:performance` script runs, with their budgets. */
export function performanceGates(root) {
  const script = readJson(root, 'package.json').scripts['test:performance'];
  const names = [...script.matchAll(/pnpm --filter (\S+) test:performance/g)].map(match => match[1]);
  if (!names.length) throw new Error('The root test:performance script runs no package gates');
  const dirs = packageDirs(root);
  const gates = [];
  for (const name of names) {
    const dir = dirs[name];
    if (!dir) throw new Error(`test:performance names ${name}, which is not a workspace package`);
    const own = readJson(root, `${dir}/package.json`).scripts['test:performance'];
    for (const [, config] of own.matchAll(/--config (\S+)/g)) {
      const configText = readFileSync(resolve(root, dir, config), 'utf8');
      const include = /include:\s*\[([^\]]*)\]/.exec(configText);
      const pattern = /testNamePattern:\s*\/(.+)\/,/.exec(configText);
      if (!include || !pattern) throw new Error(`${dir}/${config} needs an include list and a testNamePattern`);
      for (const [, file] of include[1].matchAll(/'([^']+)'/g)) {
        const path = `${dir}/${file}`;
        const found = gatesInFile(readFileSync(resolve(root, path), 'utf8'), new RegExp(pattern[1]));
        if (!found.length) throw new Error(`${path} has no performance tests matching ${pattern[0]}`);
        for (const gate of found) gates.push({ package: name, file: path, ...gate });
      }
    }
  }
  return gates;
}

const cell = text => String(text).replaceAll('|', '\\|').replaceAll('\n', ' ');
const code = text => `\`${text}\``;
const link = path => `[${code(path)}](../${path})`;
const evidenceLink = (item, specIds) => (specIds.has(item) ? code(item) : link(item));

/** The whole of docs/STATUS.md, before Prettier. */
export function render({ counts, floors, checklist, scenarios, gates }) {
  const specIds = new Set(scenarios.map(scenario => scenario.id));
  const lines = [
    '# Status',
    '',
    `<!-- Generated by \`pnpm run status\` (scripts/status.mjs). Do not edit by hand. -->`,
    '',
    `Generated from the behaviour scenarios in ${link(SCENARIOS_DIR)}, the checklist in ${link(CHECKLIST_FILE)}, the performance gates the root \`test:performance\` script runs, and the floors in ${link(FLOORS_FILE)}. Edit those, then run \`pnpm run status\`. CI fails if this file is stale.`,
    '',
    'Passing these checks shows their stated coverage, not complete CAD tool coverage or a physical machining run. To run them, see the [browser regression recipes](../apps/camNC/e2e/cad/README.md), the [behaviour specs](../apps/camNC/e2e/spec/README.md) and [TESTING.md](TESTING.md).',
    '',
    '## Known gaps',
    '',
    'Pick work from here. Fixing a gap means removing its `known` marker or moving its checklist row on, and regenerating this file.',
    '',
  ];
  const known = scenarios.filter(scenario => scenario.known);
  const flaky = scenarios.filter(scenario => scenario.flaky);
  const gapRows = checklist.areas.flatMap(area => area.rows.filter(row => row.status === 'gap').map(row => ({ area: area.name, ...row })));
  if (known.length) {
    lines.push('Specs that must still fail (XFAIL):', '', '| Spec | Reason |', '| --- | --- |');
    for (const scenario of known) lines.push(`| ${code(scenario.id)} | ${cell(scenario.known)} |`);
    lines.push('');
  } else lines.push('No spec is marked as a known gap.', '');
  if (flaky.length) {
    lines.push('Quarantined specs (FLAKY):', '', '| Spec | Issue |', '| --- | --- |');
    for (const scenario of flaky) lines.push(`| ${code(scenario.id)} | ${cell(scenario.flaky)} |`);
    lines.push('');
  }
  if (gapRows.length) {
    lines.push('Checklist gaps:', '', '| Area | Item | Note |', '| --- | --- | --- |');
    for (const row of gapRows) lines.push(`| ${row.area} | ${cell(row.item)} | ${cell(row.note ?? '')} |`);
    lines.push('');
  }

  lines.push(
    '## Behaviour specs',
    '',
    'Counted from the scenario files, without running them. PASS counts every scenario expected to pass, including quarantined ones; XFAIL is a known gap. A domain’s PASS may never drop below its floor.',
    '',
    '| Domain | Scenarios | PASS | XFAIL | FLAKY | Floor |',
    '| --- | --: | --: | --: | --: | --: |'
  );
  for (const [domain, count] of Object.entries(counts))
    lines.push(`| ${domain} | ${count.total} | ${count.pass} | ${count.xfail} | ${count.flaky} | ${floors[domain] ?? '–'} |`);
  lines.push('', '| Group | Scenarios | PASS | XFAIL | FLAKY |', '| --- | --: | --: | --: | --: |');
  for (const count of Object.values(counts))
    for (const [group, g] of Object.entries(count.groups).sort(([a], [b]) => a.localeCompare(b)))
      lines.push(`| ${code(group)} | ${g.total} | ${g.pass} | ${g.xfail} | ${g.flaky} |`);
  lines.push('');

  lines.push('## Checklist', '');
  lines.push(Object.entries(checklist.statuses).map(([status, meaning]) => `**${status}**: ${meaning}.`).join(' '), '');
  for (const area of checklist.areas) {
    const tally = Object.keys(checklist.statuses)
      .map(status => [status, area.rows.filter(row => row.status === status).length])
      .filter(([, n]) => n)
      .map(([status, n]) => `${n} ${status}`)
      .join(', ');
    lines.push(`### ${area.name}`, '', `${tally}.`, '', '| Item | Status | Evidence | Note |', '| --- | --- | --- | --- |');
    for (const row of area.rows)
      lines.push(
        `| ${cell(row.item)} | ${row.status} | ${row.evidence.map(item => evidenceLink(item, specIds)).join(', ')} | ${cell(row.note ?? '')} |`
      );
    lines.push('');
  }

  lines.push(
    '## Performance gates',
    '',
    'Run by `pnpm run test:performance`, the "Performance gates" CI step, on a runner whose functional tests have finished. Each budget is the test’s own `toBeLessThan` limit.',
    '',
    '| Package | Test file | Gate | Budget |',
    '| --- | --- | --- | --- |'
  );
  for (const gate of gates)
    lines.push(
      `| ${gate.package} | ${link(gate.file)} | ${cell(gate.title)}${gate.cases ? ` (each of ${code(gate.cases)})` : ''} | ${gate.budget} |`
    );
  lines.push('');
  return lines.join('\n');
}

async function formatMarkdown(root, text) {
  const prettier = await import('prettier');
  const filepath = resolve(root, STATUS_FILE);
  return prettier.format(text, { ...(await prettier.resolveConfig(filepath)), filepath });
}

/** Everything the check and `--write` need, read from the tree. */
export async function generate(root) {
  const scenarios = loadScenarios(root);
  const checklist = readJson(root, CHECKLIST_FILE);
  const floors = existsSync(resolve(root, FLOORS_FILE)) ? readJson(root, FLOORS_FILE) : {};
  const counts = specCounts(scenarios);
  const specIds = new Set(scenarios.map(scenario => scenario.id));
  const evidenceErrors = checkChecklist(checklist, { specIds, fileExists: path => existsSync(resolve(root, path)) });
  const floorResult = checkFloors(counts, floors);
  const gates = performanceGates(root);
  const status = (floors_ = floors) => formatMarkdown(root, render({ counts, floors: floors_, checklist, scenarios, gates }));
  return { counts, floors, evidenceErrors, floorResult, status };
}

/** Runs the CLI. Resolves to the exit code. */
export async function main(args, { root = resolve(fileURLToPath(import.meta.url), '../..') } = {}) {
  const writing = args.includes('--write');
  const unknown = args.find(arg => arg !== '--write');
  if (unknown) {
    console.error(`Unknown option ${unknown}`);
    return 2;
  }
  const { floors, evidenceErrors, floorResult, status } = await generate(root);
  const drops = floorResult.errors.filter(error => error.includes('below its floor'));

  if (writing) {
    const errors = [...evidenceErrors, ...drops];
    for (const error of errors) console.error(`status: ${error}`);
    if (errors.length) return 1;
    if (JSON.stringify(floorResult.floors) !== JSON.stringify(floors)) {
      writeFileSync(resolve(root, FLOORS_FILE), `${JSON.stringify(floorResult.floors, null, 2)}\n`);
      for (const [domain, floor] of Object.entries(floorResult.floors))
        if (floors[domain] !== floor) console.log(`${FLOORS_FILE}: ${domain} floor ${floors[domain] ?? 'added'} → ${floor}`);
    }
    writeFileSync(resolve(root, STATUS_FILE), await status(floorResult.floors));
    console.log(`Wrote ${STATUS_FILE}.`);
    return 0;
  }

  const errors = [...evidenceErrors, ...floorResult.errors];
  const committed = existsSync(resolve(root, STATUS_FILE)) ? readFileSync(resolve(root, STATUS_FILE), 'utf8') : null;
  if (committed !== (await status())) errors.push(`${STATUS_FILE} is not what its sources generate. ${regenerate}`);
  for (const error of errors) console.error(`status: ${error}`);
  return errors.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
