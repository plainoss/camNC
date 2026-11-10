import { describe, expect, it } from 'vitest';
import { parseCadDocument, type CadPointEntity } from '@wbcnc/cad';
import { editCad } from './edit';
import { measuredSketchBounds } from './curveBounds';
import type { SketchEdit } from './editTypes';
const fast = { toolpaths: false };

describe('measured bounds fitting', () => {
  it('fits the true cubic height, retains IDs and follows target dimensions after reload', async () => {
    let fit: ReturnType<SketchEdit['fitBounds']> | undefined;
    const first = await editCad(
      null,
      d => {
        d.variable('panelW', '200mm');
        d.variable('panelH', '120mm');
        const p = d.newPart('Curved panel');
        const curve = p.profile.bezier({
          points: [
            [0, 0],
            [0, 100],
            [100, 100],
            [100, 0],
          ],
        });
        const base = p.profile.line([100, 0], [0, 0]);
        fit = p.profile.fitBounds([curve, base], { w: 'panelW', h: 'panelH', at: [10, 20], preserveAspect: false });
      },
      fast
    );
    expect(first.ok, JSON.stringify(first.report)).toBe(true);
    expect(fit!.source.size).toEqual([100, 75]);
    expect(fit!.fitted.size).toEqual([200, 120]);
    const sketch = first.document.parts[0]!.sketch,
      ids = sketch.entities.map(e => e.id);
    expect(measuredSketchBounds(sketch).at[0]).toBeCloseTo(10, 6);
    expect(measuredSketchBounds(sketch).at[1]).toBeCloseTo(20, 6);
    expect(measuredSketchBounds(sketch).size[1]).toBeCloseTo(120, 6);
    const second = await editCad(
      parseCadDocument(JSON.parse(JSON.stringify(first.document))),
      d => {
        d.variable('panelW', '300mm');
        d.variable('panelH', '180mm');
      },
      fast
    );
    expect(second.ok, JSON.stringify(second.report)).toBe(true);
    const resized = second.document.parts[0]!.sketch;
    expect(resized.entities.map(e => e.id)).toEqual(ids);
    expect(measuredSketchBounds(resized).size[0]).toBeCloseTo(300, 6);
    expect(measuredSketchBounds(resized).size[1]).toBeCloseTo(180, 6);
    expect(second.report.parts[0]!.sketches[0]!.freedom).toBe(0);
    expect(second.report.parts[0]!.sketches[0]!.fitting?.bounds?.size).toEqual([300, 180]);
  });
  it('uniformly contains an oval, even when the limiting target axis changes', async () => {
    const first = await editCad(
      null,
      d => {
        d.variable('w', '100mm');
        d.variable('h', '100mm');
        const p = d.newPart('Badge');
        const ellipse = p.profile.ellipse({ at: [0, 0], rx: 40, ry: 20 });
        const fit = p.profile.fitBounds([ellipse], { w: 'w', h: 'h', preserveAspect: true });
        expect(fit.fitted.size).toEqual([100, 50]);
      },
      fast
    );
    expect(first.ok, JSON.stringify(first.report)).toBe(true);
    const second = await editCad(first.document, d => d.variable('h', '30mm'), fast);
    expect(second.ok, JSON.stringify(second.report)).toBe(true);
    const bounds = measuredSketchBounds(second.document.parts[0]!.sketch);
    expect(bounds.at[0]).toBeCloseTo(0, 5);
    expect(bounds.at[1]).toBeCloseTo(0, 5);
    expect(bounds.size[0]).toBeCloseTo(60, 5);
    expect(bounds.size[1]).toBeCloseTo(30, 5);
  });
  it('fits a dimensioned rectangle without changing its stable line/point identities', async () => {
    const first = await editCad(
      null,
      d => {
        d.variable('width', '120mm');
        d.variable('height', '80mm');
        const p = d.newPart('Panel');
        const outline = p.profile.rect({ at: [0, 0], w: 60, h: 40 });
        p.profile.fitBounds([outline], { w: 'width', h: 'height', at: [5, 10], preserveAspect: false });
      },
      fast
    );
    expect(first.ok, JSON.stringify(first.report)).toBe(true);
    const ids = first.document.parts[0]!.sketch.entities.map(e => e.id);
    const second = await editCad(first.document, d => d.variable('width', '180mm'), fast);
    expect(second.ok, JSON.stringify(second.report)).toBe(true);
    expect(second.document.parts[0]!.sketch.entities.map(e => e.id)).toEqual(ids);
    expect(measuredSketchBounds(second.document.parts[0]!.sketch).size[0]).toBeCloseTo(180, 6);
  });
  it('refuses silent distortion of circular geometry and fitting shared external endpoints', async () => {
    const oval = await editCad(
      null,
      d => {
        const p = d.newPart('Oval');
        const e = p.profile.ellipse({ at: [50, 50], rx: 30, ry: 20 });
        p.profile.fitBounds([e], { w: 100, h: 100, preserveAspect: false });
      },
      fast
    );
    expect(oval.scriptError).toMatch(/Nonuniform/);
    expect(oval.document.parts).toHaveLength(0);
    const partial = await editCad(
      null,
      d => {
        const p = d.newPart('Panel');
        const r = p.profile.rect({ at: [10, 10], w: 100, h: 80 });
        p.profile.fitBounds([r.edges.bottom], { w: 200, h: 100, preserveAspect: false });
      },
      fast
    );
    expect(partial.scriptError).toMatch(/nonzero measured width and height|unselected/);
  });
  it('reports native control and fit-point coordinates rather than generic curve tags', async () => {
    const result = await editCad(
      null,
      d => {
        d.variable('rise', '50mm');
        const p = d.newPart('Rail');
        p.profile.spline({
          points: [
            [0, 0],
            [30, 'rise'],
            [70, 'rise'],
            [100, 0],
          ],
        });
        p.profile.line([100, 0], [0, 0]);
      },
      fast
    );
    expect(result.ok, JSON.stringify(result.report)).toBe(true);
    const curve = result.report.parts[0]!.sketches[0]!.entities.find(e => e.type === 'spline');
    expect(curve).toMatchObject({
      degree: 3,
      fitPoints: expect.arrayContaining([expect.objectContaining({ at: [30, 50], expressions: { y: 'rise' } })]),
    });
    expect(curve).toHaveProperty('controls');
    expect(curve).toHaveProperty('bounds');
    const sketch = result.document.parts[0]!.sketch;
    expect(sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').every(e => Number.isFinite(e.x))).toBe(true);
  });
});
