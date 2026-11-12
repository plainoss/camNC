import { describe, expect, it } from 'vitest';
import { editCad } from './edit';

// Bounded feasibility probe for #585, not a complete chair or a strength test.
describe('retained panel joint prototype', () => {
  it('makes an enclosed seat mortise and an accessible transverse retention key', async () => {
    const result = await editCad(null, d => {
      const side = d.newPart('Side', { thickness: 18, relief: 3.175 });
      side.profile.rect({ at: [0, 0], w: 420, h: 900 });
      side.place({ at: [0, 0, 0], x: '+y', y: '+z' });
      const seat = d.newPart('Seat', { thickness: 18 });
      seat.profile
        .path([18, 0])
        .lineTo([422, 0])
        .lineTo([422, 402])
        .lineTo([18, 402])
        .lineTo([18, 120])
        .lineTo([-36, 120])
        .lineTo([-36, 60])
        .lineTo([18, 60])
        .close();
      seat.profile.rect({ at: [-18.1, 80.9], w: 18.2, h: 18.2 });
      seat.place({ at: [0, 0, 432] });
      d.cutParts(side, { with: seat, clearance: 0.1 });
      // The upper/lower portions of this key lie outside the 18 mm seat. Pulling
      // the seat out along X brings the key against the side's outside face.
      const key = d.newPart('Key blank', { thickness: 18 });
      key.profile.rect({ at: [-18, 410], w: 18, h: 64 });
      key.place({ at: [0, 99, 0], x: '+x', y: '+z' });
    });
    expect(result.scriptError).toBeUndefined();
    expect(result.report.errors).toEqual([]);
    expect(result.report.assembly?.collisions).toEqual([]);
    const side = result.report.parts.find(p => p.name === 'Side')!;
    // The boolean compiler partitions the slot at the external key opening's
    // projected boundaries. Together the three cells form one closed mortise.
    expect(side.cuts).toHaveLength(3);
    expect(side.cuts.every(c => c.through && c.at[1] === 431.9 && c.size[1] === 18.2)).toBe(true);
    expect(Math.min(...side.cuts.map(c => c.at[0]!))).toBe(59.9);
    expect(Math.max(...side.cuts.map(c => c.at[0]! + c.size[0]!))).toBe(120.1);
    expect(result.parts.find(p => p.name === 'Seat')!.holes).toHaveLength(1);
    expect(result.parts.find(p => p.name === 'Key blank')!.thickness).toBe(18);
    const withdrawal = (removeKey: boolean) =>
      editCad(result.document, d => {
        d.part('Seat').place({ at: [1, 0, 432] });
        if (removeKey) d.removePart('Key blank');
        else d.part('Key blank').place({ at: [1, 99, 0], x: '+x', y: '+z' });
      });
    expect((await withdrawal(false)).report.assembly!.collisions.length).toBeGreaterThan(0);
    expect((await withdrawal(true)).report.assembly!.collisions).toEqual([]);
  });

  it('machines perpendicular shouldered mortises before bonding two leg laminations', async () => {
    const result = await editCad(null, d => {
      const layers = [0, 40].map((x, i) => {
        const p = d.newPart(`Leg layer ${i + 1}`, { thickness: 40, relief: 3.175 });
        p.profile.rect({ at: [0, 0], w: 80, h: 632 });
        p.place({ at: [x, 0, 0], x: '+y', y: '+z' });
        return p;
      });
      const rails = ['Front apron', 'Side apron'].map((name, i) => {
        const p = d.newPart(name, { thickness: 18 });
        p.profile
          .path([80, 562])
          .lineTo([260, 562])
          .lineTo([260, 632])
          .lineTo([80, 632])
          .lineTo([80, 617])
          .lineTo([56, 617])
          .lineTo([56, 577])
          .lineTo([80, 577])
          .close();
        p.place(i === 0 ? { at: [0, 49, 0], x: '+x', y: '+z' } : { at: [31, 0, 0], x: '+y', y: '+z' });
        return p;
      });
      d.cutParts(layers, { with: rails, clearance: 0.1 });
    });
    expect(result.scriptError).toBeUndefined();
    expect(result.report.errors).toEqual([]);
    expect(result.report.assembly?.collisions).toEqual([]);
    const layers = result.report.parts.filter(p => p.name.startsWith('Leg layer'));
    expect(layers).toHaveLength(2);
    expect(layers.map(p => p.cuts.length)).toEqual([1, 2]);
    expect(layers.every(p => p.cuts.every(c => c.to > 0 && c.to <= 40))).toBe(true);
  });
});
