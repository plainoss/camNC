import { beforeAll, describe, expect, it } from 'vitest';
import { editCad, type CadEditResult } from '../edit';
import { fullCadReport } from '../fullReport';
import { cadViewBodies, cadViewLines } from './geometry';
import { renderCadViews } from './render';
import { renderCadSection } from './section';

let result: CadEditResult;
beforeAll(async () => {
  result = await editCad(null, d => {
    const part = d.newPart('Panel <&>', { thickness: 18 });
    part.profile.polygon([
      [0, 0],
      [100, 0],
      [100, 60],
      [60, 60],
      [60, 100],
      [0, 100],
    ]);
    part.place({ at: [50, 20, 30] });
    const top = part.sketchOn('top');
    top.rect({ at: [10, 10], w: 30, h: 20 });
    part.cut(top.regionAt(20, 20), { depth: 12 });
    const bottom = part.sketchOn('underside');
    bottom.rect({ at: [-90, 10], w: 20, h: 20 });
    part.cut(bottom.regionAt(-80, 20), { depth: 4 });
    part.copy({ at: [250, 20, 30], mirrored: true, name: 'Mirror' });
  });
  expect(result.ok).toBe(true);
}, 60_000);

describe('evaluated assembly drawings', () => {
  it('draws the actual nonrectangular outline, top and underside cuts, and mirrored copies', () => {
    const bodies = cadViewBodies(result.document, result.parts);
    expect(bodies.map(body => body.name)).toEqual(['Panel <&>', 'Mirror']);
    const lines = cadViewLines(bodies[0]);
    expect(lines.find(line => line.kind === 'outline')?.points).toHaveLength(6);
    expect(
      lines
        .filter(line => line.kind === 'cut' && line.closed)
        .map(line => line.points[0][2])
        .sort((a, b) => a - b)
    ).toEqual([30, 34, 36, 48]);
    const views = renderCadViews(result.document, result.parts);
    expect(views.map(view => view.name)).toEqual(['top', 'front', 'right']);
    expect(views[0].bounds).toEqual({ at: [50, 20], size: [200, 100] });
    for (const view of views) {
      expect(view.svg).toContain('class="cut"');
      expect(view.svg).toContain('data-body="Mirror"');
      expect(view.svg).toContain('Panel &lt;&amp;&gt;');
      expect(view.svg).not.toMatch(/NaN|Infinity/);
    }
  });

  it('does not emit suppressed folders or their physical copies', () => {
    const source = result.document.parts[0];
    const document = { ...result.document, parts: [{ ...source, suppressed: true as const }] };
    expect(cadViewBodies(document, result.parts)).toEqual([]);
    for (const view of renderCadViews(document, result.parts)) {
      expect(view.svg).not.toMatch(/class="outline"|NaN|Infinity/);
    }
  });

  it('adds optional drawings to the report without changing the default report shape', async () => {
    const plain = await fullCadReport(result.document, result);
    expect(plain.views).toBeUndefined();
    const drawn = await fullCadReport(result.document, result, { views: true });
    expect(drawn.views).toHaveLength(3);
    expect(drawn.views?.[0].svg).toContain('class="cut"');
  });
});

describe('sections through named cuts', () => {
  const cut = () => result.parts[0].cuts!.find(cut => cut.side === 'top')!;
  it('shows the true 6 mm pocket floor and 14 mm material over an underside cut', () => {
    const section = renderCadSection(result.document, result.parts, { part: 'Panel <&>', cut: cut().id });
    expect(section.at).toBe(20);
    expect(section.material).toContainEqual({ from: 10, to: 40, low: 0, high: 6 });
    expect(section.material).toContainEqual({ from: 70, to: 90, low: 4, high: 18 });
    expect(section.svg).toContain('6 mm floor');
    expect(section.svg).toContain('class="material"');
    expect(section.svg).not.toMatch(/NaN|Infinity/);
  });

  it('can section along the other sketch axis and rejects a line that misses the cut', () => {
    const section = renderCadSection(result.document, result.parts, {
      part: result.document.parts[0].id,
      cut: cut().id.slice(0, 4),
      axis: 'y',
      at: 20,
    });
    expect(section.material).toContainEqual({ from: 10, to: 30, low: 0, high: 6 });
    expect(() => renderCadSection(result.document, result.parts, { part: 'Panel <&>', cut: cut().id, at: 80 })).toThrow('does not cross');
    expect(() => renderCadSection(result.document, result.parts, { part: 'missing', cut: cut().id })).toThrow('No physical part');
    expect(() => renderCadSection(result.document, result.parts, { part: 'Panel <&>', cut: 'missing' })).toThrow('No cut');
  });

  it('unites overlapping top and underside removals instead of drawing material in the void', async () => {
    const overlapping = await editCad(null, d => {
      const panel = d.newPart('Overlap', { thickness: 18 });
      panel.profile.rect({ at: [0, 0], w: 100, h: 80 });
      const top = panel.sketchOn('top');
      top.rect({ at: [20, 10], w: 30, h: 30 });
      panel.cut(top.regionAt(30, 20), { depth: 8 });
      const underside = panel.sketchOn('underside');
      underside.rect({ at: [-60, 10], w: 30, h: 30 });
      panel.cut(underside.regionAt(-40, 20), { depth: 4 });
    });
    expect(overlapping.ok).toBe(true);
    const section = renderCadSection(overlapping.document, overlapping.parts, {
      part: 'Overlap',
      cut: overlapping.parts[0].cuts![0].id,
      at: 20,
    });
    expect(section.material).toContainEqual({ from: 30, to: 50, low: 4, high: 10 });
  }, 60_000);
});
