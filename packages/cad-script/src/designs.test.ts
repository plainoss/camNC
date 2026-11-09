import { readdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseCadDocument } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { fullCadReport, fullReportText } from './fullReport';

// Saved designs, each checked against the full report kept next to it. See the README's "Golden reports".
const folder = fileURLToPath(new URL('../fixtures/designs/', import.meta.url));
const designs = readdirSync(folder)
  .filter(file => file.endsWith('.json') && !file.endsWith('.report.json'))
  .sort();
const update = process.env.UPDATE_GOLDENS === '1';

describe('saved designs', () => {
  it('are there', () => expect(designs.length).toBeGreaterThan(0));

  it.each(designs)(
    '%s matches its golden report',
    async file => {
      const document = parseCadDocument(JSON.parse(await readFile(`${folder}${file}`, 'utf8')));
      const text = fullReportText(await fullCadReport(document));
      const golden = `${folder}${file.replace(/\.json$/, '.report.json')}`;
      if (update) return writeFile(golden, text);
      const expected = await readFile(golden, 'utf8').catch(() => null);
      if (expected === null)
        throw new Error(
          `No golden report for ${file}. Create it with "UPDATE_GOLDENS=1 pnpm --filter @wbcnc/cad-script exec vitest run designs", then review it.`
        );
      // Parsed, so a failure shows the fields that differ rather than one long line.
      expect(JSON.parse(text), `${file} no longer matches its golden report; rerun with UPDATE_GOLDENS=1 if that is intended`).toEqual(
        JSON.parse(expected)
      );
      // The text too, so a golden edited by hand into another order or rounding is caught.
      expect(text).toBe(expected);
    },
    60_000
  );
});
