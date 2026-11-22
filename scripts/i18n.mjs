/** Extract only explicit application translation calls. Never scan or translate machine commands heuristically. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import { untranslatedDisplayText } from './i18n-interpolations.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));

const directory = 'packages/i18n/src/locales';
const roots = ['apps/camNC/src', 'packages/ui/src', 'packages/cad-editor/src', 'packages/cam-settings/src'];
const previousEnglish = JSON.parse(fs.readFileSync(`${directory}/en.json`, 'utf8'));
const french = JSON.parse(fs.readFileSync(`${directory}/fr.json`, 'utf8'));
const messages = new Set();
const errors = [];
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}
for (const file of roots.flatMap(files).filter(file => /\.[jt]sx?$/.test(file) && !/\.(test|spec)\.|\.gen\./.test(file))) {
  const ast = parse(fs.readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && ['t', 'translate'].includes(node.callee.name) && node.arguments[0]?.type === 'StringLiteral') {
      messages.add(node.arguments[0].value);
      if (node.arguments[1]?.type === 'ObjectExpression')
        for (const property of node.arguments[1].properties)
          if (property.value?.type === 'ConditionalExpression')
            for (const text of untranslatedDisplayText(property.value)) errors.push(`Untranslated display interpolation in ${file}: ${text}`);
    }
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'extra', 'comments', 'tokens'].includes(key)) continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(ast);
}
// Controller descriptions are localized when displayed; the transport library and raw console lines stay unchanged.
const controllerTables = parse(fs.readFileSync('packages/fluidnc/src/parsers/errors.ts', 'utf8'), { sourceType: 'module', plugins: ['typescript'] });
for (const declaration of controllerTables.program.body) {
  for (const item of declaration.declaration?.declarations ?? []) {
    if (['kErrorMessages', 'kAlarmMessages'].includes(item.id.name))
      for (const property of item.init.properties) if (property.value?.type === 'StringLiteral') messages.add(property.value.value);
  }
}

// i18next chooses these according to Intl plural rules. Keep their base source key out of the catalog.
for (const key of [...messages]) {
  if (Object.hasOwn(previousEnglish, `${key}_one`)) {
    messages.delete(key);
    messages.add(`${key}_one`);
    messages.add(`${key}_other`);
  }
}
const english = Object.fromEntries([...messages].sort().map(key => [key, previousEnglish[key] ?? key]));
const placeholders = text => [...text.matchAll(/{{\s*([^}]+)\s*}}/g)].map(match => match[1]).sort().join('|');
for (const key of messages) {
  if (!french[key]?.trim()) errors.push(`Missing French translation: ${key}`);
  else if (placeholders(english[key]) !== placeholders(french[key])) errors.push(`Interpolation differs: ${key}`);
}
if (process.argv.includes('--write')) {
  fs.writeFileSync(`${directory}/en.json`, `${JSON.stringify(english, null, 2)}\n`);
  const retained = Object.fromEntries(Object.keys(english).map(key => [key, french[key] ?? '']));
  fs.writeFileSync(`${directory}/fr.json`, `${JSON.stringify(retained, null, 2)}\n`);
} else if (JSON.stringify(english) !== JSON.stringify(previousEnglish)) {
  errors.push('English catalog is stale; run pnpm i18n:extract.');
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else console.log(`${messages.size} application messages: English/French catalogs and placeholders verified.`);
