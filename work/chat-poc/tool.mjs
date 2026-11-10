#!/usr/bin/env node
// Stand-in for the tools an in-app chat model would have: read the open design, check a script against a copy of it,
// and look at drawings of the result. Every check is logged, so tries and failure kinds are measured, not self-reported.
import { spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const [command, conversation, ...rest] = process.argv.slice(2);
if (!command || !conversation) {
  console.error('Usage: tool.mjs context <conversation> | check <conversation> <turn> <script.cad.ts>');
  process.exit(2);
}
const dir = path.join(here, conversation);
const design = path.join(dir, 'design.json');

const check = args => {
  const started = Date.now();
  const run = spawnSync('pnpm', ['--silent', '--filter', '@wbcnc/cad-script', 'check', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
  return { stdout: run.stdout, status: run.status, ms: Date.now() - started };
};

/** Front, right and top views of the placed parts' boxes, from the report's assembly. */
function views(parts) {
  if (!parts?.length) return null;
  const lo = [0, 1, 2].map(k => Math.min(...parts.map(p => p.at[k])));
  const hi = [0, 1, 2].map(k => Math.max(...parts.map(p => p.at[k] + p.size[k])));
  const span = [0, 1, 2].map(k => hi[k] - lo[k]);
  const scale = 420 / Math.max(...span, 1);
  const gap = 60;
  const panels = [
    { title: 'FRONT (X right, Z up)', u: 0, v: 2, depth: 1, near: -1 },
    { title: 'RIGHT (Y right, Z up)', u: 1, v: 2, depth: 0, near: 1 },
    { title: 'TOP (X right, Y up)', u: 0, v: 1, depth: 2, near: 1 },
  ];
  let x = gap;
  const height = Math.max(span[2], span[1]) * scale + 2 * gap + 30;
  const colours = ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#76b7b2', '#b07aa1', '#9c755f', '#edc948', '#ff9da7', '#bab0ac'];
  const colourOf = new Map();
  let body = '';
  for (const panel of panels) {
    const w = span[panel.u] * scale;
    const h = span[panel.v] * scale;
    body += `<text x="${x}" y="24" font-size="15" font-family="sans-serif">${panel.title}  ${span[panel.u].toFixed(0)} × ${span[panel.v].toFixed(0)} mm</text>`;
    // Farthest first, so nearer parts are drawn over what they hide.
    const ordered = [...parts].sort((a, b) => panel.near * (a.at[panel.depth] - b.at[panel.depth]));
    for (const part of ordered) {
      const base = part.name.replace(/ \d+$/, '');
      if (!colourOf.has(base)) colourOf.set(base, colours[colourOf.size % colours.length]);
      const px = x + (part.at[panel.u] - lo[panel.u]) * scale;
      const pw = part.size[panel.u] * scale;
      const ph = part.size[panel.v] * scale;
      const py = 40 + h - (part.at[panel.v] - lo[panel.v]) * scale - ph;
      body += `<rect x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${pw.toFixed(1)}" height="${ph.toFixed(1)}" fill="${colourOf.get(base)}" fill-opacity="0.35" stroke="#222" stroke-width="1"/>`;
      body += `<text x="${(px + pw / 2).toFixed(1)}" y="${(py + ph / 2 + 4).toFixed(1)}" font-size="10" font-family="sans-serif" text-anchor="middle">${part.name}</text>`;
    }
    x += Math.max(w, 330) + gap;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${x.toFixed(0)}" height="${height.toFixed(0)}"><rect width="100%" height="100%" fill="white"/>${body}</svg>`;
}

const png = (svg, out) => spawnSync('rsvg-convert', ['-w', '1400', '-b', 'white', svg, '-o', out]);

if (command === 'context') {
  if (!existsSync(design)) {
    console.log('The design is empty: no parts yet.');
    process.exit(0);
  }
  const { stdout } = check(['--from', design, '--report', 'full']);
  const report = JSON.parse(stdout);
  // What gets cut from which board is CAM's business, and the largest part of the report.
  delete report.boards;
  for (const body of report.bodies ?? []) delete body.toolpaths;
  console.log(JSON.stringify(report));
  const drawn = views(report.assembly?.parts);
  if (drawn) {
    writeFileSync(path.join(dir, 'design.views.svg'), drawn);
    png(path.join(dir, 'design.views.svg'), path.join(dir, 'design.views.png'));
    console.log(`\nViews of the open design: ${path.join(dir, 'design.views.png')}`);
  }
} else if (command === 'check') {
  const [turn, script] = rest;
  if (!turn || !script) {
    console.error('Usage: tool.mjs check <conversation> <turn> <script.cad.ts>');
    process.exit(2);
  }
  const turnDir = path.join(dir, `turn${turn}`);
  const attempts = path.join(turnDir, 'attempts');
  mkdirSync(attempts, { recursive: true });
  const n = readdirSync(attempts).filter(file => file.endsWith('.cad.ts')).length + 1;
  const source = path.resolve(script);
  copyFileSync(source, path.join(attempts, `${n}.cad.ts`));
  const candidate = path.join(turnDir, 'candidate.json');
  const partsSvg = path.join(turnDir, 'parts.svg');
  for (const file of ['views.svg', 'views.png', 'parts.png']) rmSync(path.join(turnDir, file), { force: true });
  const { stdout, status, ms } = check([source, ...(existsSync(design) ? ['--from', design] : []), '--out', candidate, '--svg', partsSvg]);
  writeFileSync(path.join(attempts, `${n}.report.json`), stdout);
  let report = null;
  try {
    report = JSON.parse(stdout);
  } catch {
    /* not a report */
  }
  const kind = !report ? 'crash' : report.typeErrors ? 'typeError' : report.scriptError ? 'scriptError' : report.ok ? 'ok' : 'checkFailed';
  appendFileSync(
    path.join(turnDir, 'log.jsonl'),
    `${JSON.stringify({ n, kind, ms, errors: report?.errors?.map(e => e.code), warnings: report?.warnings?.map(w => w.code) })}\n`
  );
  if (report) {
    for (const part of report.parts ?? []) delete part.toolpaths;
    console.log(JSON.stringify(report));
  } else console.log(stdout);
  const drawn = report && views(report.assembly?.parts);
  if (drawn) {
    writeFileSync(path.join(turnDir, 'views.svg'), drawn);
    png(path.join(turnDir, 'views.svg'), path.join(turnDir, 'views.png'));
    console.log(`\nFront, right and top views of the placed parts: ${path.join(turnDir, 'views.png')}`);
  }
  if (existsSync(partsSvg)) {
    png(partsSvg, path.join(turnDir, 'parts.png'));
    console.log(`Each part from above, with its cuts: ${path.join(turnDir, 'parts.png')}`);
  }
  console.log(`\nAttempt ${n}: ${kind}${status ? ` (exit ${status})` : ''}`);
} else {
  console.error(`Unknown command ${command}`);
  process.exit(2);
}
