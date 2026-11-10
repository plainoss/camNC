import { describe, expect, it } from 'vitest';
import { parseCadDocument, setPartPattern } from '@wbcnc/cad';
import { editCad } from './edit';

async function radialLegs() {
  const made = await editCad(null, d => {
    const leg = d.newPart('Leg');
    leg.profile.rect({ at: [100, -10], w: 40, h: 20 });
    leg.place({ at: [0, 0, 0] });
  });
  return setPartPattern(made.document, made.document.parts[0]!.id, {
    axis: 'z',
    count: 4,
    spacing: 0,
    circular: { origin: [0, 0, 0], axis: [0, 0, 1], angle: 360, equalSpacing: true },
  });
}

describe('editing existing circular part patterns', () => {
  it('changes the count and suppression without replacing the angle, axis or stable logical instances', async () => {
    const source = await radialLegs();
    const pattern = source.parts[0]!.pattern!;
    const changed = await editCad(source, d => d.step(pattern.id).set({ count: 6 }));
    expect(changed.ok, JSON.stringify(changed.report.errors)).toBe(true);
    expect(changed.document.parts[0]!.pattern).toEqual({ ...pattern, count: 6 });
    expect(changed.document.parts[0]!.copies!.map(copy => copy.id)).toEqual([1, 2, 3, 4, 5].map(slot => `${pattern.id}:${slot}`));
    expect(changed.document.parts[0]!.copies![0]!.placement!.rotation[2]).toBeCloseTo(0.5, 10);
    const hidden = await editCad(changed.document, d => d.step(pattern.id).set({ suppressed: true }));
    expect(hidden.ok).toBe(true);
    const restored = await editCad(hidden.document, d => d.step(pattern.id).set({ suppressed: false }));
    expect(restored.ok).toBe(true);
    expect(restored.document.parts[0]!.pattern!.circular).toEqual(pattern.circular);
    expect(restored.document.parts[0]!.copies!.map(copy => copy.id)).toEqual(changed.document.parts[0]!.copies!.map(copy => copy.id));
  });

  it.each([{ spacing: 50 }, { axis: 'x' as const }])('refuses ignored linear settings %j without changing the design', async setting => {
    const source = await radialLegs();
    const changed = await editCad(source, d => d.step(source.parts[0]!.pattern!.id).set(setting));
    expect(changed.scriptError).toMatch(/Circular pattern.*Available settings: count, suppressed/);
    expect(changed.document).toEqual(source);
  });

  it('requires explicit removal before replacing a circular pattern with a linear one', async () => {
    const source = await radialLegs();
    const refused = await editCad(source, d => d.part('Leg').pattern({ axis: 'z', count: 4, spacing: 100 }));
    expect(refused.scriptError).toMatch(/circular pattern.*removePattern/);
    expect(refused.document).toEqual(source);
    const replaced = await editCad(source, d => {
      d.removePattern('Leg');
      d.part('Leg').pattern({ axis: 'z', count: 4, spacing: 100 });
    });
    expect(replaced.ok).toBe(true);
    expect(replaced.document.parts[0]!.pattern!.circular).toBeUndefined();
  });

  it('detaches one radial leg with its hole and keeps its slot excluded through count edits and reload', async () => {
    const source = await radialLegs();
    const patternId = source.parts[0]!.pattern!.id;
    const copyId = source.parts[0]!.copies![0]!.id;
    const made = await editCad(source, d => {
      const leg = d.existingCopy('Leg 2');
      const top = leg.sketchOn('top');
      top.circle({ at: [120, 0], d: 6 });
      leg.cut(top.regionAt(120, 0), { depth: 'through' });
    });
    expect(made.ok).toBe(true);
    const detached = await editCad(made.document, d => {
      d.detachCopy('Leg 2', 'Cable leg');
    });
    expect(detached.ok).toBe(true);
    const own = detached.document.parts.find(part => part.name === 'Cable leg')!;
    let current = detached;
    for (const count of [6, 3, 6]) {
      current = await editCad(parseCadDocument(JSON.parse(JSON.stringify(current.document))), d => d.step(patternId).set({ count }));
      expect(current.ok, JSON.stringify(current.report.errors)).toBe(true);
      expect(current.document.parts[0]!.pattern!.excluded).toEqual([1]);
      expect(current.document.parts[0]!.pattern!.circular).toEqual(source.parts[0]!.pattern!.circular);
      expect(current.document.parts[0]!.copies!.some(copy => copy.id === copyId)).toBe(false);
      expect(current.document.parts.find(part => part.id === own.id)!.placement).toEqual(own.placement);
      expect(current.parts.find(part => part.partId === own.id)!.cuts).toHaveLength(1);
    }
  });
});
