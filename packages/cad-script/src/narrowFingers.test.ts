import { readFile } from 'node:fs/promises';
import { parseCadDocument, setCadVariable } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { inspectCadDocument } from './index';

const fittedJoints = new URL('../fixtures/designs/fitted-joints.json', import.meta.url);

async function withFingers(count: number) {
  const document = parseCadDocument(JSON.parse(await readFile(fittedJoints, 'utf8')));
  const variable = document.variables!.find(v => v.name === 'fingers')!;
  const changed = setCadVariable(document, { id: variable.id, name: 'fingers', expression: `${count}` });
  if ('error' in changed) throw new Error(changed.error);
  return (await inspectCadDocument(changed.document)).report;
}

describe('finger joints narrower than the bit', () => {
  it('names the part, the joint and the finger width against the bit', async () => {
    // 100 mm frame height in 60 fingers: about 1.67 mm each, against the default ⌀3.175 mm bit.
    const report = await withFingers(60);
    const missing = report.warnings.filter(w => w.code === 'toolpath-missing');
    expect(missing.map(w => w.part).sort()).toEqual(['Front', 'Side']);
    expect(missing.find(w => w.part === 'Front')!.message).toMatch(
      /^The fingers of the finger joint with Side are about 1\.\d mm wide, narrower than the ⌀3\.175 mm bit: CAM runs the outline straight across its \d+ slots, so the joint isn't cut\./
    );
    expect(missing.find(w => w.part === 'Side')!.message).toMatch(/finger joint with Front/);
  }, 60_000);

  it('wide fingers are cut: no warning', async () => {
    const report = await withFingers(5);
    expect(report.warnings.filter(w => w.code === 'toolpath-missing')).toEqual([]);
  }, 60_000);
});
