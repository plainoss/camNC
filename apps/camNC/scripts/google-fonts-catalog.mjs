// Writes src/cam/googleFonts.json: the Google Fonts families the lettering picker offers, most popular first, as
// [family, category, upright weights]. Run it to pick up new families: node scripts/google-fonts-catalog.mjs
import { writeFile } from 'node:fs/promises';

const kCategories = { 'Sans Serif': 'sans', Serif: 'serif', Display: 'display', Handwriting: 'handwriting', Monospace: 'mono' };

const text = await (await fetch('https://fonts.google.com/metadata/fonts')).text();
const { familyMetadataList } = JSON.parse(text.slice(text.indexOf('{')));
const families = familyMetadataList
  // Lettering is typed in Latin script; color and icon fonts have no outlines to carve.
  .filter(f => f.subsets.includes('latin') && !f.colorCapabilities?.length && f.category in kCategories)
  .filter(f => !/icons|symbols/i.test(f.family))
  .sort((a, b) => a.popularity - b.popularity)
  .map(f => [
    f.family,
    kCategories[f.category],
    Object.keys(f.fonts)
      .filter(k => /^\d+$/.test(k))
      .map(Number)
      .sort((a, b) => a - b),
  ])
  .filter(([, , weights]) => weights.length);
await writeFile(new URL('../src/cam/googleFonts.json', import.meta.url), `[\n${families.map(f => JSON.stringify(f)).join(',\n')}\n]\n`);
console.log(`${families.length} families`);
