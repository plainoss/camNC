import { readFile } from 'node:fs/promises';
import { parseCadDocument, setCadVariable } from '@wbcnc/cad';
import { camPart, profileFeatures } from '@wbcnc/cam';
import { describe, expect, it } from 'vitest';
import { inspectCadDocument } from './index';
import { narrowFingersWarnings } from './narrowFingers';

const fittedJoints = new URL('../fixtures/designs/fitted-joints.json', import.meta.url);

async function withFingers(count: number) {
  const document = parseCadDocument(JSON.parse(await readFile(fittedJoints, 'utf8')));
  const variable = document.variables!.find(v => v.name === 'fingers')!;
  const changed = setCadVariable(document, { id: variable.id, name: 'fingers', expression: `${count}` });
  if ('error' in changed) throw new Error(changed.error);
  return inspectCadDocument(changed.document);
}

describe('finger joints narrower than the bit', () => {
  it('names the part, the joint and the finger width against the bit', async () => {
    // 100 mm frame height in 60 fingers: about 1.67 mm each, against the default ⌀3.175 mm bit.
    const { report } = await withFingers(60);
    const missing = report.warnings.filter(w => w.code === 'toolpath-missing');
    expect(missing.map(w => w.part).sort()).toEqual(['Front', 'Side']);
    expect(missing.find(w => w.part === 'Front')!.message).toMatch(
      /^The fingers of the finger joint with Side are about 1\.\d mm wide, narrower than the ⌀3\.175 mm bit: CAM runs the outline straight across its \d+ slots, so the joint isn't cut\./
    );
    expect(missing.find(w => w.part === 'Side')!.message).toMatch(/finger joint with Front/);
    // Not the half-lap legs: their joint is fine.
    expect(report.warnings.filter(w => w.part === 'Leg A' || w.part === 'Leg B').map(w => w.code)).not.toContain('toolpath-missing');
  }, 60_000);

  it('many fingers far narrower than a 6 mm bit: still the joint', async () => {
    // 70 fingers: about 1.43 mm each, under a quarter of the bit's radius as a disk, but each slot a long piece.
    const { document, parts } = await withFingers(70);
    const front = parts.find(p => p.name === 'Front')!;
    const profile = profileFeatures(front);
    const cam = camPart(profile.features, { tools: [{ number: 1, diameter: 6, name: 'flat end mill' }] });
    expect(cam.outlineNotches?.filter(n => n.spans).length).toBe(1);
    const nameOf = (id: string) => document.parts.find(p => p.id === id)?.name;
    const [message, ...more] = narrowFingersWarnings(document, front, cam.outlineNotches!, profile.offset, nameOf);
    expect(more).toEqual([]);
    expect(message).toMatch(/^The fingers of the finger joint with Side are about 1\.4 mm wide, narrower than the ⌀6 mm bit/);
  }, 60_000);

  it('wide fingers are cut: no warning', async () => {
    const { report } = await withFingers(5);
    expect(report.warnings.filter(w => w.code === 'toolpath-missing')).toEqual([]);
  }, 60_000);
});
