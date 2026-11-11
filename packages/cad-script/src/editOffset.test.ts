import { describe, expect, it } from 'vitest';
import { parseCadDocument, type CadPointEntity } from '@wbcnc/cad';
import { editCad } from './edit';
const fast = { toolpaths: false };

describe('linked scripted offsets', () => {
  it('keeps rectangular source/target identities through size and offset edits', async () => {
    const first = await editCad(
      null,
      d => {
        d.variable('width', '100mm');
        d.variable('rim', '10mm');
        const p = d.newPart('Frame');
        const outline = p.profile.rect({ at: [0, 0], w: 'width', h: 80 });
        p.profile.offset([outline], { distance: 'rim' });
      },
      fast
    );
    expect(first.ok, JSON.stringify(first.report)).toBe(true);
    const ids = first.document.parts[0]!.sketch.entities.map(e => e.id);
    const second = await editCad(
      parseCadDocument(JSON.parse(JSON.stringify(first.document))),
      d => {
        d.variable('width', '140mm');
        d.variable('rim', '15mm');
      },
      fast
    );
    expect(second.ok, JSON.stringify(second.report)).toBe(true);
    const sketch = second.document.parts[0]!.sketch;
    expect(sketch.entities.map(e => e.id)).toEqual(ids);
    const offset = sketch.constraints.find(c => c.type === 'offset')!;
    expect(offset).toMatchObject({ value: 15, expression: 'rim' });
    const points = new Map(sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(p => [p.id, p]));
    const target = sketch.entities.find(e => e.id === offset.members[0]!.targetId)!;
    if (target.type !== 'line') throw Error('Expected offset line');
    expect(points.get(target.startId)!.y).toBeCloseTo(15, 6);
    expect(second.report.parts[0]!.holes).toBe(1);
    expect(second.report.parts[0]!.sketches[0]!.freedom).toBe(0);
  });
  it('retains a circle offset radius when both source and distance change', async () => {
    const first = await editCad(
      null,
      d => {
        d.variable('diameter', '100mm');
        d.variable('rim', '10mm');
        const p = d.newPart('Ring');
        const circle = p.profile.circle({ at: [0, 0], d: 'diameter' });
        p.profile.offset([circle], { distance: 'rim' });
      },
      fast
    );
    expect(first.ok, JSON.stringify(first.report)).toBe(true);
    const next = await editCad(
      first.document,
      d => {
        d.variable('diameter', '140mm');
        d.variable('rim', '20mm');
      },
      fast
    );
    expect(next.ok, JSON.stringify(next.report)).toBe(true);
    expect(
      next.document.parts[0]!.sketch.entities.filter(e => e.type === 'circle')
        .map(e => e.radius)
        .sort((a, b) => a - b)
    ).toEqual([50, 70]);
  });
  it('links circular arcs in a closed line/arc outline rather than polygonizing them', async () => {
    const result = await editCad(
      null,
      d => {
        const p = d.newPart('Curved frame');
        const outline = p.profile
          .path([0, 0])
          .lineTo([100, 0])
          .arcTo([100, 40], { r: 20 })
          .lineTo([0, 40])
          .arcTo([0, 0], { r: 20 })
          .close();
        p.profile.offset([outline], { distance: 5 });
      },
      fast
    );
    expect(result.ok, JSON.stringify(result.report)).toBe(true);
    const sketch = result.document.parts[0]!.sketch;
    expect(sketch.entities.filter(e => e.type === 'arc')).toHaveLength(8);
    expect(sketch.constraints.find(c => c.type === 'offset')!.members.some(m => m.kind === 'arc')).toBe(true);
  });
  it('refuses unsupported native curves and collapsed offsets atomically', async () => {
    const first = await editCad(
      null,
      d => {
        const p = d.newPart('Oval');
        const ellipse = p.profile.ellipse({ at: [50, 50], rx: 30, ry: 20 });
        p.profile.offset([ellipse], { distance: 2 });
      },
      fast
    );
    expect(first.scriptError).toMatch(/supports straight lines, circles and circular arcs/);
    expect(first.document.parts).toHaveLength(0);
    const collapsed = await editCad(
      null,
      d => {
        const p = d.newPart('Ring');
        const circle = p.profile.circle({ at: [0, 0], d: 10 });
        p.profile.offset([circle], { distance: 10 });
      },
      fast
    );
    expect(collapsed.scriptError).toMatch(/collapse/);
  });
});

it('keeps a line/arc offset linked through radius and clearance expression edits', async () => {
  const first = await editCad(
    null,
    d => {
      d.variable('height', '40mm');
      d.variable('rim', '5mm');
      const p = d.newPart('Curved frame');
      const outline = p.profile
        .path([0, 0])
        .lineTo([100, 0])
        .arcTo([100, 'height'], { r: 'height/2' })
        .lineTo([0, 'height'])
        .arcTo([0, 0], { r: 'height/2' })
        .close();
      p.profile.offset([outline], { distance: 'rim' });
    },
    fast
  );
  expect(first.ok, JSON.stringify(first.report)).toBe(true);
  const ids = first.document.parts[0]!.sketch.entities.map(e => e.id);
  const next = await editCad(
    first.document,
    d => {
      d.variable('height', '60mm');
      d.variable('rim', '8mm');
    },
    fast
  );
  expect(next.ok, JSON.stringify(next.report)).toBe(true);
  expect(next.document.parts[0]!.sketch.entities.map(e => e.id)).toEqual(ids);
  expect(next.report.parts[0]!.outline?.size).toEqual([160, 60]);
  expect(next.report.parts[0]!.holes).toBe(1);
  const radii = next.document.parts[0]!.sketch.entities.filter(e => e.type === 'arc').map(e => e.radius);
  expect(radii.filter(r => Math.abs(r - 30) < 1e-6)).toHaveLength(4);
  expect(radii.filter(r => Math.abs(r - 22) < 1e-6)).toHaveLength(4);
});
