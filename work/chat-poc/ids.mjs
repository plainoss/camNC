// Which IDs of the open design survive in the candidate: parts, their sketch entities and constraints, features, variables.
import { readFileSync } from 'node:fs';
const [a, b] = process.argv.slice(2).map(f => JSON.parse(readFileSync(f, 'utf8')));
const ids = doc => {
  const out = new Map();
  for (const v of doc.variables ?? []) out.set(v.id, `variable ${v.name}`);
  for (const c of doc.partCuts ?? []) out.set(c.id, 'partCut');
  for (const p of doc.parts) {
    out.set(p.id, `part ${p.name}`);
    for (const e of p.sketch.entities) out.set(e.id, `entity of ${p.name}`);
    for (const c of p.sketch.constraints) out.set(c.id, `constraint of ${p.name}`);
    for (const f of p.features ?? []) out.set(f.id, `feature of ${p.name}`);
    for (const c of p.copies ?? []) out.set(`${p.id}/${c.id}`, `copy of ${p.name}`);
  }
  return out;
};
const before = ids(a), after = ids(b);
const lost = [...before].filter(([id]) => !after.has(id));
const added = [...after].filter(([id]) => !before.has(id));
const tally = list => Object.entries(list.reduce((t, [, what]) => ((t[what] = (t[what] ?? 0) + 1), t), {})).map(([k, n]) => `${n} ${k}`).join(', ') || 'none';
console.log(`kept ${before.size - lost.length} of ${before.size} IDs`);
console.log(`lost: ${tally(lost)}`);
console.log(`added: ${tally(added)}`);
const partsBefore = new Map(a.parts.map(p => [p.id, JSON.stringify(p)]));
console.log('parts unchanged byte for byte:', b.parts.filter(p => partsBefore.get(p.id) === JSON.stringify(p)).map(p => p.name).join(', ') || 'none');
