import { describe, expect, it } from 'vitest';
import { editCad, inspectCadDocument } from './index';
import { newCadId } from '@wbcnc/cad';
import { renderCadSvg } from './render';
import { isEdgeNotch } from './notch';

describe('report sizes', () => {
  it.each(['top', 'underside'] as const)('measures circles and arcs exactly on %s', async side => {
    const { report } = await editCad(null, d => {
      const part = d.part('Panel', { thickness: 18 });
      part.profile.rect({ at: [0, 0], w: 200, h: 150 });
      const sketch = part.sketchOn(side);
      const x = side === 'underside' ? -100 : 100;
      sketch.circle({ at: [x, 40], d: 35 });
      part.cut(sketch.regionAt(x, 40), { depth: 12 });
      sketch
        .path([x - 20, 80])
        .lineTo([x + 20, 80])
        .arcTo([x + 20, 90], { tangent: true })
        .lineTo([x - 20, 90])
        .arcTo([x - 20, 80], { tangent: true })
        .close();
      part.cut(sketch.regionAt(x, 85), { depth: 5 });
    });
    expect(report.errors).toEqual([]);
    expect(report.parts[0]!.cuts).toMatchObject([
      { side, at: [82.5, 22.5], size: [35, 35] },
      { side, at: [75, 80], size: [50, 10] },
    ]);
  });
});

describe('report pieces', () => {
  it('lists copies a tool reaches differently with the rest of the part', async () => {
    const { report } = await editCad(null, d => {
      const panel = d.part('Panel', { thickness: 18 });
      panel.profile.rect({ at: [0, 0], w: 200, h: 100 });
      panel.place({ at: [0, 0, 0] });
      panel.copy({ at: [0, 0, 100] });
      panel.copy({ at: [1000, 0, 0] });
      const pin = d.part('Pin', { thickness: 18 });
      pin.profile.rect({ at: [0, 0], w: 20, h: 20 });
      pin.place({ at: [90, 40, 10] });
      d.cutParts(panel, { with: [pin], clearance: 0 });
    });
    expect(report.errors).toEqual([]);
    expect(report.parts[0]!.pieces).toEqual({ names: ['Panel', 'Panel 2', 'Panel 3'], mirrored: [] });
  });
});

describe('report holes', () => {
  it('counts profile holes and through cuts, including pattern copies and floor cuts, once each', async () => {
    const { report } = await editCad(null, d => {
      const part = d.part('Panel', { thickness: 18 });
      part.profile.rect({ at: [0, 0], w: 200, h: 150 });
      part.profile.circle({ at: [15, 15], d: 8 });
      part.profile.circle({ at: [35, 15], d: 8 });
      part.cut(part.profile.regionAt(35, 15), { depth: 'through' });
      part.profile.circle({ at: [55, 15], d: 8 });
      part.cut(part.profile.regionAt(55, 15), { depth: 5 });
      const top = part.sketchOn('top');
      top.pattern([top.rect({ at: [20, 40], w: 10, h: 10 })], { count: 3, step: [30, 0] });
      part.cut(top.regionAt(25, 45), { depth: 'through' });
      const under = part.sketchOn('underside');
      under.circle({ at: [-140, 40], d: 10 });
      part.cut(under.regionAt(-140, 40), { depth: 'through' });
      top.rect({ at: [20, 80], w: 40, h: 40 });
      const pocket = part.cut(top.regionAt(40, 100), { depth: 5 });
      const floor = part.sketchOn({ floorOf: pocket });
      floor.circle({ at: [40, 100], d: 10 });
      part.cut(floor.regionAt(40, 100), { depth: 'through' });
      top.circle({ at: [170, 100], d: 10 });
      part.expect({ holes: 7, pockets: 2 });
    });
    expect(report.parts[0]!.holes).toBe(7);
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });
});

describe('report expectations with variables', () => {
  it('evaluates sizes, thickness and depths after variables change', async () => {
    const { report } = await editCad(null, d => {
      d.variable('width', '100mm');
      d.variable('board', '18mm');
      d.variable('pegDepth', '5mm');
      const part = d.part('Panel', { thickness: 'board' });
      part.profile.rect({ at: [0, 0], w: 'width', h: 80 });
      const top = part.sketchOn('top');
      top.circle({ at: [20, 20], d: 10 });
      part.cut(top.regionAt(20, 20), { depth: 'pegDepth' });
      part.expect({ size: ['width', '40mm * 2'], thickness: 'board', depths: ['pegDepth'] });
      d.variable('width', '120mm');
      d.variable('pegDepth', '7mm');
      d.variable('board', '20mm');
      part.expect({ size: ['width', 80] });
    });
    expect(report.errors).toEqual([]);
  });

  it.each(['missingDepth', 'depth + ('])('reports invalid expression %s as a check failure', async expression => {
    const { report, scriptError } = await editCad(null, d => {
      const part = d.part('Panel', { thickness: 18 });
      part.profile.rect({ at: [0, 0], w: 100, h: 80 });
      part.expect({ size: [expression, 80], thickness: expression, depths: [expression] });
    });
    expect(scriptError).toBeUndefined();
    expect(report.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'expect-failed', message: expect.stringContaining(expression) })])
    );
    expect(report.errors.some(error => error.message.includes('invalid expression'))).toBe(true);
  });
});

describe('report edge notches', () => {
  it('separates edge openings cut by tools from enclosed holes', async () => {
    const { report, parts } = await editCad(null, d => {
      const part = d.part('Panel', { thickness: 18 });
      part.profile.rect({ at: [0, 0], w: 100, h: 80 });
      part.place({ at: [0, 0, 0] });
      const tools = [
        [-5, 10, 15],
        [0, 40, 10],
        [40, 20, 10],
      ].map(([x, y, w], i) => {
        const tool = d.part(`Tool ${i}`, { thickness: 18 });
        tool.profile.rect({ at: [0, 0], w: w!, h: 10 });
        tool.place({ at: [x!, y!, 0] });
        return tool;
      });
      d.cutParts(part, { with: tools, clearance: 0 });
      part.expect({ holes: 1, notches: 2 });
    });
    expect(report.errors).toEqual([]);
    expect(report.parts[0]).toMatchObject({ holes: 1, notches: 2 });
    const svg = renderCadSvg(parts.slice(0, 1));
    expect(svg.match(/class="notch"/g)).toHaveLength(2);
    expect(svg.match(/>notch<\/text>/g)).toHaveLength(2);
  });
});

describe('report missing pattern copies', () => {
  it('warns when an overlapping shape swallows patterned cut regions', async () => {
    const { report } = await editCad(null, d => {
      const part = d.part('Panel', { thickness: 18 });
      part.profile.rect({ at: [0, 0], w: 200, h: 100 });
      const top = part.sketchOn('top');
      const hole = top.circle({ at: [20, 20], d: 10 });
      top.pattern([hole], { count: 4, step: [40, 0] });
      top.rect({ at: [50, 20], w: 100, h: 20 });
      part.cut(top.regionAt(20, 20), { depth: 5 });
    });
    expect(report.errors).toEqual([]);
    expect(report.parts[0]!.cuts).toHaveLength(1);
    const pattern = report.parts[0]!.sketches.find(sketch => sketch.on === 'top')!.patterns![0]!;
    expect(pattern.copies).toBe(3);
    expect(report.warnings).toContainEqual(
      expect.objectContaining({
        code: 'pattern-copies-missing',
        part: 'Panel',
        message: expect.stringMatching(/3.*missing/),
        entities: [pattern.ref],
      })
    );
  });
});

describe('report straight path closure', () => {
  it.each([false, true])('warns only when the added straight edge is unacknowledged (straight: %s)', async straight => {
    let firstEdge = '';
    const { report } = await editCad(null, d => {
      const part = d.part('Panel', { thickness: 18 });
      const path = part.profile.path([0, 0]).lineTo([100, 0]).lineTo([100, 80]).lineTo([0, 80]);
      const closed = straight ? path.close({ straight: true }) : path.close();
      firstEdge = closed.edges[0]!.id;
    });
    expect(report.errors).toEqual([]);
    const warnings = report.warnings.filter(warning => warning.code === 'close-straight');
    expect(warnings).toHaveLength(straight ? 0 : 1);
    if (!straight) {
      expect(firstEdge.startsWith(warnings[0]!.entities![0]!)).toBe(true);
      expect(warnings[0]!.message).toContain('0, 80');
      expect(warnings[0]!.message).toContain('0, 0');
      expect(warnings[0]!.message).toContain(warnings[0]!.entities![0]!);
    }
  });

  it('does not warn when the final segment already returns to the start', async () => {
    const { report } = await editCad(null, d => {
      const part = d.part('Panel', { thickness: 18 });
      part.profile.path([0, 0]).lineTo([100, 0]).lineTo([0, 80]).lineTo([0, 0]).close();
    });
    expect(report.errors).toEqual([]);
    expect(report.warnings.filter(warning => warning.code === 'close-straight')).toEqual([]);
  });
});

describe('report constraint warning locations', () => {
  it('names the entities involved in redundant constraints', async () => {
    let lineId = '';
    const { document } = await editCad(null, d => {
      const part = d.part('Panel', { thickness: 18 });
      const rect = part.profile.rect({ at: [0, 0], w: 100, h: 80 });
      lineId = rect.edges.bottom.id;
    });
    const sketch = document.parts[0]!.sketch;
    sketch.constraints.push({ id: newCadId(), type: 'horizontal', entityId: lineId });
    const { report } = await inspectCadDocument(document, new Map(), { toolpaths: false });
    expect(report.errors).toEqual([]);
    const warning = report.warnings.find(warning => warning.code === 'redundant-constraint');
    expect(warning).toBeDefined();
    expect(warning!.entities?.some(ref => lineId.startsWith(ref))).toBe(true);
    expect(warning!.message).toContain(warning!.entities![0]!);
  });
});

describe('report notch geometry', () => {
  const outline = [
    [0, 0],
    [100, 0],
    [100, 80],
    [0, 80],
  ].map(([x, y]) => ({ x: x!, y: y! }));
  const cutAt = (x: number, y: number) => ({
    through: true,
    outline: [
      { x, y },
      { x: x + 10, y },
      { x: x + 10, y: y + 10 },
      { x, y: y + 10 },
    ],
  });

  it.each([
    [0, 20],
    [90, 20],
    [20, 0],
    [20, 70],
    [-5, 20],
  ])('recognizes touching or crossing the boundary at %s, %s', (x, y) => {
    expect(isEdgeNotch(cutAt(x, y), outline)).toBe(true);
  });

  it('keeps strictly enclosed holes and blind edge pockets separate', () => {
    expect(isEdgeNotch(cutAt(20, 20), outline)).toBe(false);
    expect(isEdgeNotch({ ...cutAt(0, 20), through: false }, outline)).toBe(false);
  });

  it('detects a segment crossing a concave boundary even with all cut vertices inside', () => {
    const concave = [
      [0, 0],
      [100, 0],
      [100, 80],
      [60, 80],
      [60, 30],
      [40, 30],
      [40, 80],
      [0, 80],
    ].map(([x, y]) => ({ x: x!, y: y! }));
    const cut = {
      through: true,
      outline: [
        [20, 20],
        [80, 20],
        [80, 60],
        [20, 60],
      ].map(([x, y]) => ({ x: x!, y: y! })),
    };
    expect(isEdgeNotch(cut, concave)).toBe(true);
  });
});

describe('report intact patterns', () => {
  it('does not warn about intact copies, separate cuts, or copies intentionally removed by a smaller count', async () => {
    const { report } = await editCad(null, d => {
      d.variable('count', '4');
      const part = d.part('Panel', { thickness: 18 });
      part.profile.rect({ at: [0, 0], w: 200, h: 100 });
      const top = part.sketchOn('top');
      top.pattern([top.circle({ at: [20, 20], d: 10 })], { count: 'count', step: [40, 0] });
      part.cut(top.regionAt(20, 20), { depth: 5 });
      part.cut(top.regionAt(60, 20), { depth: 7 });
      d.variable('count', '3');
      part.expect({ depths: [5, 5, 7], notches: 0 });
    });
    expect(report.errors).toEqual([]);
    expect(report.warnings.filter(warning => warning.code === 'pattern-copies-missing')).toEqual([]);
  });
});
