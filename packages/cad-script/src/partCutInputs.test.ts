import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseCadDocument } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { inspectCadDocument } from './inspect';

const design = fileURLToPath(new URL('../fixtures/designs/fitted-joints.json', import.meta.url));

describe('a Cut parts step whose tool’s Extrude is deleted', () => {
  it('fails the check on the parts it joins, naming the tool', async () => {
    const document = parseCadDocument(JSON.parse(await readFile(design, 'utf8')));
    if (!document) throw new Error('fitted-joints.json no longer parses');
    // As deleting "Extrude · Front" in the studio leaves it: Front's sketch, which the step still names as its tool.
    const sketchOnly = {
      ...document,
      parts: document.parts.map(part => (part.name === 'Front' ? { ...part, extrude: false as const } : part)),
    };
    const { report } = await inspectCadDocument(sketchOnly);
    expect(report.ok).toBe(false);
    expect(report.errors).toEqual(
      ['Front', 'Side'].map(part => ({
        code: 'part-cut-input',
        message: 'Cut Side with Front can’t use its tool Front, which isn’t extruded.',
        part,
      }))
    );
  });
});
