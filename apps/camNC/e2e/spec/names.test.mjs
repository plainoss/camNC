import { describe, expect, it } from 'vitest';
import { CONTEXTS, parseGlossary, parseName } from './names.mjs';

const glossary = `# Terms

Intro text | with a pipe.

| term | other | camNC accessible name | role | where | checked |
| ---- | ----- | --------------------- | ---- | ----- | ------- |
| Feature list | x | \`Features\` | region | studio | |
| Depth | x | /^Thickness/ | textbox | extrude | |
| Region selection | x | \`Select profile\` (then a box) | button | extrude-add | |
| Named views | x | — | — | studio | |
| Eye | x | /^(Show\\|Hide) / | button | studio | |

After the table.
`;

describe('glossary names', () => {
  it('reads the rows of the table with name, role and where columns', () => {
    expect(parseGlossary(glossary)).toEqual([
      { term: 'Feature list', name: { exact: 'Features' }, role: 'region', where: 'studio' },
      { term: 'Depth', name: { pattern: '^Thickness', flags: '' }, role: 'textbox', where: 'extrude' },
      { term: 'Region selection', name: { exact: 'Select profile' }, role: 'button', where: 'extrude-add' },
      { term: 'Named views', name: null, role: '—', where: 'studio' },
      { term: 'Eye', name: { pattern: '^(Show|Hide) ', flags: '' }, role: 'button', where: 'studio' },
    ]);
  });
  it('refuses a file without such a table, and knows every context it names', () => {
    expect(() => parseGlossary('| a | b |\n| - | - |\n')).toThrow(/No table/);
    expect(parseName('plain text')).toBeNull();
    expect(parseName('`Rectangle tools` › `Center rectangle` (a menu)')).toEqual({ exact: 'Center rectangle', menus: ['Rectangle tools'] });
    for (const where of parseGlossary(glossary).map(row => row.where)) expect(CONTEXTS[where]).toBeDefined();
  });
});
