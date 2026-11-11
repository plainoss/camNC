import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseCadDocument, type CadDocument } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { inspectCadDocument } from './inspect';

const design = fileURLToPath(new URL('../fixtures/designs/fitted-joints.json', import.meta.url));

/** The fitted-joints design with one variable typed differently, as the editor saves it. */
async function withVariable(name: string, expression: string): Promise<CadDocument> {
  const document = parseCadDocument(JSON.parse(await readFile(design, 'utf8')));
  if (!document) throw new Error('fitted-joints.json no longer parses');
  return {
    ...document,
    variables: document.variables!.map(variable => (variable.name === name ? { ...variable, expression } : variable)),
  };
}

describe('values that can’t follow their variables', () => {
  it.each(['1', '0', '2.5'])('fail the check for a finger count of %s on both joined parts', async fingers => {
    const { report } = await inspectCadDocument(await withVariable('fingers', fingers));
    expect(report.ok).toBe(false);
    expect(report.errors).toEqual(
      ['Front', 'Side'].map(part => ({
        code: 'variable-value',
        message: `Finger count fingers = ${fingers} in Cut Side with Front: a finger joint needs a whole number of fingers, at least 2.`,
        part,
      }))
    );
  });

  it('fail the check for a thickness below the minimum on each part', async () => {
    const { report } = await inspectCadDocument(await withVariable('board', '0'));
    expect(report.ok).toBe(false);
    expect(report.errors.map(error => [error.part, error.code])).toEqual(
      ['Leg A', 'Leg B', 'Front', 'Side'].map(part => [part, 'variable-value'])
    );
    expect(report.errors[0]!.message).toBe('Thickness board: Thickness must be at least 0.1 mm.');
  });

  it('pass with a valid finger count', async () => {
    const { report } = await inspectCadDocument(await withVariable('fingers', '3'));
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });
});
