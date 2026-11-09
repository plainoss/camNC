import { readdirSync, readFileSync } from 'node:fs';
import { createPlateDocument } from './document';
import type { CadDocument } from './types';

const designs = new URL('../../cad-script/fixtures/designs/', import.meta.url);
const own = new URL('./fixtures/', import.meta.url);

/**
 * Saved designs to fuzz: the CAD script's design corpus (sketches, faces, cuts, patterns, copies, variables), this
 * package's own fixtures and a fresh plate. Test-only, Node-only. Each call returns fresh copies.
 */
export function fuzzFixtureDocuments(): { name: string; text: string; document: CadDocument }[] {
  const read = (dir: URL, file: string) => {
    const text = readFileSync(new URL(file, dir), 'utf8');
    return { name: file.replace(/\.json$/, ''), text, document: JSON.parse(text) as CadDocument };
  };
  const json = (dir: URL) =>
    readdirSync(dir)
      .filter(file => file.endsWith('.json') && !file.endsWith('.report.json'))
      .sort();
  const plate = createPlateDocument();
  return [
    ...json(designs).map(file => read(designs, file)),
    ...json(own).map(file => read(own, file)),
    { name: 'plate (created)', text: JSON.stringify(plate), document: plate },
  ];
}
