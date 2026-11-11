import { describe, expect, it } from 'vitest';
import {
  addArc,
  addBezier,
  addCircle,
  addConic,
  addLine,
  addSpline,
  clampedCurveData,
  evaluateCurvePoint,
  evaluateRationalCurve,
  rationalCurveData,
  sketchToDxf,
  sketchToSvg,
  type CadNurbsEntity,
} from './index';
import { addEllipse } from './ellipse';
import type { CadPoint, CadPointEntity, CadSketch } from './types';

const pointsOf = (sketch: CadSketch) =>
  new Map(sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(e => [e.id, e as CadPoint]));

/** A sketch with every kind of curve, one of them construction. */
function everyCurve(): CadSketch {
  let sketch: CadSketch = { id: 's', entities: [], constraints: [] };
  sketch = addLine(sketch, { x1: 0, y1: 0, x2: 100, y2: 0 });
  sketch = addCircle(sketch, { x: 50, y: 50, radius: 10 });
  sketch = addArc(sketch, { cx: 0, cy: 0, radius: 10, startAngle: 0, endAngle: Math.PI / 2 });
  sketch = addArc(sketch, { cx: 200, cy: 0, radius: 20, startAngle: (3 * Math.PI) / 2, endAngle: Math.PI / 4 });
  sketch = addEllipse(sketch, { center: { x: 150, y: 80 }, axis: { x: 180, y: 100 }, through: { x: 150, y: 95 } });
  sketch = addBezier(sketch, {
    points: [
      { x: 0, y: 100 },
      { x: 20, y: 140 },
      { x: 60, y: 60 },
      { x: 80, y: 100 },
    ],
  });
  sketch = addConic(sketch, { start: { x: 100, y: 100 }, end: { x: 140, y: 100 }, control: { x: 120, y: 130 }, rho: 0.3 });
  sketch = addSpline(sketch, {
    points: [
      { x: 0, y: 200 },
      { x: 30, y: 230 },
      { x: 60, y: 190 },
      { x: 90, y: 220 },
    ],
  });
  sketch = addSpline(sketch, {
    points: [
      { x: 200, y: 200 },
      { x: 240, y: 210 },
      { x: 250, y: 250 },
      { x: 210, y: 260 },
    ],
    closed: true,
  });
  sketch = addLine(sketch, { x1: 0, y1: -10, x2: 100, y2: -10, construction: true });
  return sketch;
}

/** DXF as group-code pairs, then as entities with their codes, the way a reader takes it apart. */
function dxfEntities(text: string) {
  const lines = text.split('\n');
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([Number(lines[i]), lines[i + 1]!]);
  const start = pairs.findIndex(([c, v], i) => c === 2 && v === 'ENTITIES' && pairs[i - 1]![1] === 'SECTION');
  const entities: { type: string; codes: [number, string][] }[] = [];
  for (let i = start + 1; pairs[i]![1] !== 'ENDSEC'; i++) {
    const [code, value] = pairs[i]!;
    if (code === 0) entities.push({ type: value, codes: [] });
    else entities.at(-1)!.codes.push([code, value]);
  }
  const all = (entity: (typeof entities)[number], code: number) => entity.codes.filter(([c]) => c === code).map(([, v]) => Number(v));
  const one = (entity: (typeof entities)[number], code: number) => all(entity, code)[0]!;
  const layer = (entity: (typeof entities)[number]) => entity.codes.find(([c]) => c === 8)![1];
  return { pairs, entities, all, one, layer };
}

describe('sketch DXF export', () => {
  const sketch = everyCurve(),
    points = pointsOf(sketch);
  const curves = sketch.entities.filter(e => e.type !== 'point' && !e.construction);

  it('writes each curve as its exact DXF entity, in the sketch frame', () => {
    const dxf = dxfEntities(sketchToDxf(sketch));
    expect(dxf.entities.map(e => e.type)).toEqual(['LINE', 'CIRCLE', 'ARC', 'ARC', 'ELLIPSE', 'SPLINE', 'SPLINE', 'SPLINE', 'SPLINE']);
    const [line, circle, quarter, wrapped, ellipse] = dxf.entities;
    expect([10, 20, 11, 21].map(c => dxf.one(line!, c))).toEqual([0, 0, 100, 0]);
    expect([10, 20, 40].map(c => dxf.one(circle!, c))).toEqual([50, 50, 10]);
    expect([40, 50, 51].map(c => dxf.one(quarter!, c))).toEqual([10, 0, 90]);
    // Counterclockwise from 270° round through 0° to 45°.
    expect([50, 51].map(c => dxf.one(wrapped!, c))).toEqual([270, 45]);
    const source = curves.find(e => e.type === 'ellipse')!;
    expect(source.type).toBe('ellipse');
    const major = Math.hypot(dxf.one(ellipse!, 11), dxf.one(ellipse!, 21));
    expect(major).toBeCloseTo(Math.hypot(30, 20), 6);
    expect(dxf.one(ellipse!, 40) * major).toBeCloseTo(source.type === 'ellipse' ? source.radius : 0, 6);
  });

  it('keeps every spline on its source curve, closed splines included', () => {
    const dxf = dxfEntities(sketchToDxf(sketch));
    const splines = dxf.entities.filter(e => e.type === 'SPLINE');
    const sources = curves.filter((e): e is CadNurbsEntity => ['bezier', 'conic', 'spline'].includes(e.type));
    expect(splines).toHaveLength(sources.length);
    splines.forEach((spline, i) => {
      const source = rationalCurveData(sources[i]!, points);
      const flags = dxf.one(spline, 70);
      const knots = dxf.all(spline, 40),
        xs = dxf.all(spline, 10),
        ys = dxf.all(spline, 20);
      const weights = flags & 4 ? dxf.all(spline, 41) : xs.map(() => 1);
      expect(knots).toHaveLength(dxf.one(spline, 72));
      expect(xs).toHaveLength(dxf.one(spline, 73));
      expect(weights).toHaveLength(xs.length);
      const read = { degree: dxf.one(spline, 71), knots, weights, poles: xs.map((x, j) => ({ x, y: ys[j]! })) };
      for (let t = 0; t <= 1; t += 1 / 16) {
        const expected = evaluateRationalCurve(source, t),
          actual = evaluateRationalCurve(read, t);
        expect(Math.hypot(expected.x - actual.x, expected.y - actual.y)).toBeLessThan(1e-6);
      }
    });
    // The conic is rational; the Bézier isn't.
    expect(dxf.one(splines[0]!, 70) & 4).toBe(0);
    expect(dxf.one(splines[1]!, 70) & 4).toBe(4);
    expect(dxf.one(splines[3]!, 70) & 1).toBe(1);
  });

  it('converts to the chosen unit and records it', () => {
    const dxf = dxfEntities(sketchToDxf(sketch, { unit: 'in' }));
    const header = dxf.pairs.findIndex(([, v]) => v === '$INSUNITS');
    expect(dxf.pairs[header + 1]).toEqual([70, '1']);
    expect(dxf.one(dxf.entities[0]!, 11)).toBeCloseTo(100 / 25.4, 9);
    expect(dxf.one(dxf.entities[1]!, 40)).toBeCloseTo(10 / 25.4, 9);
  });

  it('leaves construction geometry out unless asked, then puts it on its own layer', () => {
    expect(dxfEntities(sketchToDxf(sketch)).entities.every(e => e.codes.some(([c, v]) => c === 8 && v === 'SKETCH'))).toBe(true);
    const dxf = dxfEntities(sketchToDxf(sketch, { construction: true }));
    expect(dxf.entities.map(dxf.layer).filter(layer => layer === 'CONSTRUCTION')).toHaveLength(1);
  });

  it('can write curves as polylines for readers without splines', () => {
    const dxf = dxfEntities(sketchToDxf(sketch, { splinesAsPolylines: true }));
    expect(dxf.entities.map(e => e.type)).toEqual(['LINE', 'CIRCLE', 'ARC', 'ARC', ...Array(5).fill('LWPOLYLINE')]);
    const ellipse = dxf.entities[4]!;
    expect(dxf.one(ellipse, 70)).toBe(1);
    expect(dxf.all(ellipse, 10)).toHaveLength(dxf.one(ellipse, 90));
  });

  it('gives every object a handle below $HANDSEED, once each', () => {
    const { pairs } = dxfEntities(sketchToDxf(sketch, { construction: true }));
    const handles = pairs.filter(([c]) => c === 5 || c === 105).map(([, v]) => parseInt(v, 16));
    const seed = parseInt(pairs[pairs.findIndex(([, v]) => v === '$HANDSEED') + 1]![1], 16);
    expect(new Set(handles).size).toBe(handles.length);
    expect(Math.max(...handles.filter(h => h !== seed))).toBeLessThan(seed);
  });
});

/** Samples an SVG path of M, L, Q, C and Z commands back into sketch coordinates. */
function samplePath(d: string): CadPoint[] {
  const tokens = d.match(/[MLQCAZ]|-?[\d.]+/g)!;
  const out: CadPoint[] = [];
  let at = { x: 0, y: 0 },
    i = 0;
  const next = () => ({ x: Number(tokens[i++]), y: -Number(tokens[i++]) });
  while (i < tokens.length) {
    const command = tokens[i++]!;
    if (command === 'M' || command === 'L') out.push((at = next()));
    else if (command === 'Q' || command === 'C') {
      const controls = [at, ...Array.from({ length: command === 'Q' ? 2 : 3 }, next)];
      for (let t = 0.125; t <= 1; t += 0.125) {
        let row = controls;
        while (row.length > 1)
          row = row.slice(1).map((p, j) => ({ x: row[j]!.x + (p.x - row[j]!.x) * t, y: row[j]!.y + (p.y - row[j]!.y) * t }));
        out.push(row[0]!);
      }
      at = controls.at(-1)!;
    } else if (command === 'A') throw new Error('Arc in a spline path');
  }
  return out;
}

describe('sketch SVG export', () => {
  const sketch = everyCurve(),
    points = pointsOf(sketch);
  const curves = sketch.entities.filter(e => e.type !== 'point' && !e.construction);
  const paths = (svg: string) => [...svg.matchAll(/<path d="([^"]+)"/g)].map(m => m[1]!);

  it('sizes the drawing at 1:1 in the chosen unit, origin kept', () => {
    const svg = sketchToSvg(sketch);
    const [, width, height] = svg.match(/width="([\d.]+)mm" height="([\d.]+)mm"/)!;
    const [minX, minY, w, h] = svg
      .match(/viewBox="([^"]+)"/)![1]!
      .split(' ')
      .map(Number);
    expect(Number(width)).toBeCloseTo(w!, 6);
    expect(Number(height)).toBeCloseTo(h!, 6);
    expect(minX).toBeCloseTo(0, 1);
    // The closed spline is the highest curve; y is flipped, so it sets the top.
    expect(minY).toBeLessThan(-250);
    expect(sketchToSvg(sketch, { unit: 'in' })).toMatch(/width="[\d.]+in"/);
    expect(sketchToSvg(sketch, { unit: 'm' })).toMatch(/width="[\d.]+cm"/);
  });

  it('draws lines, circles and arcs exactly, with the sweep flipped for SVG', () => {
    const [line, circle, quarter] = paths(sketchToSvg(sketch));
    expect(line).toBe('M 0 0 L 100 0');
    expect(circle).toBe('M 60 -50 A 10 10 0 0 0 40 -50 A 10 10 0 0 0 60 -50 Z');
    expect(quarter).toBe('M 10 0 A 10 10 0 0 0 0 -10');
  });

  it('keeps splines on their source curves', () => {
    const svgPaths = paths(sketchToSvg(sketch));
    const sources = curves.filter((e): e is CadNurbsEntity => ['bezier', 'conic', 'spline'].includes(e.type));
    sources.forEach((source, i) => {
      const sampled = samplePath(svgPaths[5 + i]!);
      const reference = Array.from({ length: 4001 }, (_, j) => evaluateCurvePoint(source, points, j / 4000));
      for (const p of sampled) {
        const nearest = Math.min(...reference.map(q => Math.hypot(p.x - q.x, p.y - q.y)));
        expect(nearest).toBeLessThan(0.05);
      }
    });
    // The Bézier is one exact cubic; the rational conic becomes a polyline.
    expect(svgPaths[5]).toMatch(/^M [^A-Z]+ C [^A-Z]+$/);
    expect(svgPaths[6]).not.toMatch(/[QC]/);
  });

  it('groups construction geometry apart, dashed, only when asked', () => {
    expect(sketchToSvg(sketch)).not.toContain('id="construction"');
    const svg = sketchToSvg(sketch, { construction: true });
    expect(svg).toMatch(/<g id="construction"[^>]*stroke-dasharray/);
    expect(svg.split('id="construction"')[1]).toContain('M 0 10 L 100 10');
  });
});

describe('clamped curve data', () => {
  it('turns a closed spline into joined spans on the same curve', () => {
    const sketch = addSpline(
      { id: 's', entities: [], constraints: [] },
      {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
        closed: true,
      }
    );
    const spline = sketch.entities.find(e => e.type === 'spline') as CadNurbsEntity;
    const source = rationalCurveData(spline, pointsOf(sketch)),
      clamped = clampedCurveData(source);
    expect(clamped.knots.slice(0, clamped.degree + 1).every(k => k === 0)).toBe(true);
    for (let t = 0; t <= 1; t += 1 / 32) {
      const a = evaluateRationalCurve(source, t),
        b = evaluateRationalCurve(clamped, t);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-9);
    }
  });
});
