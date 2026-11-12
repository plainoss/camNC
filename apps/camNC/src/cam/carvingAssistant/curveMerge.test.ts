import { describe, expect, it } from 'vitest';
import { flattenCurveContours, type CurveSegment } from './curveFlatten';
import { mergeCurveRuns } from './curveMerge';
import { compareTraceMasks, openTraceSlivers } from './traceMetrics';

/** A circle of radius 50 as `n` cubics with aligned tangents, the way the tracer splits a smooth stroke. */
function circle(n: number): CurveSegment[] {
  const k = (4 / 3) * Math.tan(Math.PI / (2 * n));
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n,
      b = (2 * Math.PI * (i + 1)) / n;
    return {
      type: 'C',
      x1: 50 * Math.cos(a),
      y1: 50 * Math.sin(a),
      x2: 50 * (Math.cos(a) - k * Math.sin(a)),
      y2: 50 * (Math.sin(a) + k * Math.cos(a)),
      x3: 50 * (Math.cos(b) + k * Math.sin(b)),
      y3: 50 * (Math.sin(b) - k * Math.cos(b)),
      x4: 50 * Math.cos(b),
      y4: 50 * Math.sin(b),
      joinStyle: 'gentle',
    };
  });
}
const radiusError = (loop: { x: number; y: number }[]) => Math.max(...loop.map(p => Math.abs(Math.hypot(p.x, p.y) - 50)));

describe('merging traced curve runs', () => {
  it('replaces a run of short tangent-aligned cubics with fewer, within the tolerance', () => {
    const [merged] = mergeCurveRuns([{ isholepath: false, segments: circle(32) }], 0.5);
    expect(merged.segments.length).toBeLessThanOrEqual(8);
    expect(merged.segments.length).toBeGreaterThanOrEqual(4);
    // Continuous and closed, and each join keeps a shared tangent.
    merged.segments.forEach((s, i) => {
      const next = merged.segments[(i + 1) % merged.segments.length];
      expect(Math.hypot(next.x1 - s.x4!, next.y1 - s.y4!)).toBeLessThan(1e-9);
      const cross = (s.x4! - s.x3!) * (next.y2 - next.y1) - (s.y4! - s.y3!) * (next.x2 - next.x1);
      expect(Math.abs(cross) / (Math.hypot(s.x4! - s.x3!, s.y4! - s.y3!) * Math.hypot(next.x2 - next.x1, next.y2 - next.y1))).toBeLessThan(
        1e-6
      );
    });
    expect(radiusError(flattenCurveContours([merged], 0.01)[0])).toBeLessThan(0.5);
  });

  it('keeps lines and sharp corners, and merges nothing beyond the tolerance', () => {
    const arc = circle(32).slice(0, 8);
    arc[7].joinStyle = 'sharp';
    const back: CurveSegment = { type: 'L', x1: arc[7].x4!, y1: arc[7].y4!, x2: 0, y2: 0, joinStyle: 'sharp' };
    const home: CurveSegment = { type: 'L', x1: 0, y1: 0, x2: 50, y2: 0, joinStyle: 'sharp' };
    const [merged] = mergeCurveRuns([{ isholepath: false, segments: [...arc, back, home] }], 0.5);
    expect(merged.segments.filter(s => s.type === 'L')).toEqual([back, home]);
    expect(merged.segments.length).toBe(3);
    expect(merged.segments[2]).toMatchObject({ type: 'C', joinStyle: 'sharp' });
    // A closed loop never becomes a single cubic, however loose the tolerance.
    expect(mergeCurveRuns([{ isholepath: false, segments: circle(8) }], 100)[0].segments.length).toBeGreaterThanOrEqual(2);
    const [strict] = mergeCurveRuns([{ isholepath: false, segments: circle(32) }], 1e-6);
    expect(strict.segments.length).toBe(32);
  });
});

describe('trace cleanup and coverage', () => {
  it('removes dark slivers about two pixels wide, but keeps a whole thin stroke as large as a feature', () => {
    const width = 60,
      ink = new Uint8Array(width * 40);
    for (let y = 5; y < 25; y++) for (let x = 5; x < 15; x++) ink[y * width + x] = 1;
    // A short two-pixel spike off the block, and a three-pixel bar.
    for (let x = 15; x < 25; x++) ink[10 * width + x] = ink[11 * width + x] = 1;
    for (let x = 15; x < 25; x++) ink[20 * width + x] = ink[21 * width + x] = ink[22 * width + x] = 1;
    // A separate two-pixel stroke, 40 long, and a diagonal one, 30 long, touching only at corners.
    for (let x = 5; x < 45; x++) ink[32 * width + x] = ink[33 * width + x] = 1;
    for (let k = 0; k < 30; k++) ink[(5 + k) * width + 28 + k] = ink[(5 + k) * width + 29 + k] = 1;
    expect(openTraceSlivers(ink, width, 50)).toBe(20);
    expect(ink[10 * width + 20]).toBe(0);
    expect(ink[21 * width + 20]).toBe(1);
    expect(ink[15 * width + 10]).toBe(1);
    expect(ink[32 * width + 25]).toBe(1);
    expect(ink[20 * width + 44]).toBe(1);
    // Below a larger feature area, those strokes go as slivers too.
    expect(openTraceSlivers(ink, width, 200)).toBe(80 + 60);
  });

  it('leaves an isolated tip pixel out of the boundary error, and measures thin strokes by edge displacement', () => {
    const width = 200,
      source = new Uint8Array(width * width);
    // Twelve thin strokes, three pixels wide, and a one-pixel spike, two long, that the trace rounds off.
    for (let k = 0; k < 12; k++) for (let y = 20; y < 180; y++) for (let x = 0; x < 3; x++) source[y * width + 10 + 15 * k + x] = 1;
    const traced = source.slice();
    source[19 * width + 11] = source[18 * width + 11] = 1;
    // Every stroke one pixel wider: a third of each stroke's area, but under half a pixel of displacement per edge.
    for (let k = 0; k < 12; k++) for (let y = 20; y < 180; y++) traced[y * width + 13 + 15 * k] = 1;
    const coverage = compareTraceMasks(source, traced, width, 6);
    expect(coverage.intersectionOverUnion).toBeLessThan(0.8);
    expect(coverage.meanDeviationPx).toBeLessThan(0.6);
    expect(coverage.maxBoundaryErrorPx).toBe(2);
    expect(coverage.boundaryErrorPx).toBe(1);
  });
});
