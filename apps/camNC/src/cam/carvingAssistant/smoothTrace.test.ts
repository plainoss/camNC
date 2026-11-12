import { describe, expect, it, vi } from 'vitest';
import { flattenCurveContours } from './curveFlatten';
import { smoothTrace } from './smoothTrace';
import { closeTraceGaps, compareTraceMasks, traceFeatureChanges, traceMaskTopology } from './traceMetrics';
import { smoothCurveJoins } from './curveSmoothing';

describe('smooth curve approximation and independent validation', () => {
  it('removes a tiny fitting-spike tangent kink while preserving original long book corners', () => {
    const vertices = [
      [0, 0],
      [10, 0],
      [10.2, 0.2],
      [10.4, 0],
      [20, 0],
      [20, 10],
      [0, 10],
    ];
    const [result] = smoothCurveJoins(
      [
        {
          isholepath: false,
          segments: vertices.map(([x1, y1], i) => ({
            type: 'L',
            x1,
            y1,
            x2: vertices[(i + 1) % vertices.length][0],
            y2: vertices[(i + 1) % vertices.length][1],
          })),
        },
      ],
      0.1,
      1
    );
    const atSpike = result.segments.findIndex(s => s.type === 'C' && s.x4 === 10.2 && s.y4 === 0.2);
    expect(atSpike).toBeGreaterThanOrEqual(0);
    const before = result.segments[atSpike],
      after = result.segments[(atSpike + 1) % result.segments.length];
    const incoming = [before.x4! - before.x3!, before.y4! - before.y3!],
      outgoing = [after.x2 - after.x1, after.y2 - after.y1];
    expect((incoming[0] * outgoing[0] + incoming[1] * outgoing[1]) / (Math.hypot(...incoming) * Math.hypot(...outgoing))).toBeCloseTo(1, 8);
    const bookCorner = result.segments.findIndex(s => s.x1 === 20 && s.y1 === 0);
    expect(result.segments[bookCorner]).toMatchObject({ type: 'L', x2: 20, y2: 10, joinStyle: 'sharp' });
    expect(result.segments[(bookCorner - 1 + result.segments.length) % result.segments.length]).toMatchObject({
      type: 'L',
      x2: 20,
      y2: 0,
      joinStyle: 'sharp',
    });
  });
  it('bounds measured quadratic-to-CAM chord error over the full curve', () => {
    const [loop] = flattenCurveContours(
      [
        {
          isholepath: false,
          segments: [
            { type: 'Q', x1: 0, y1: 0, x2: 50, y2: 100, x3: 100, y3: 0 },
            { type: 'L', x1: 100, y1: 0, x2: 0, y2: 0 },
          ],
        },
      ],
      0.015
    );
    const distance = (x: number, y: number) =>
      Math.min(
        ...loop.map((a, i) => {
          const b = loop[(i + 1) % loop.length],
            dx = b.x - a.x,
            dy = b.y - a.y;
          const length = dx * dx + dy * dy;
          const t = length ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length)) : 0;
          return Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
        })
      );
    for (let i = 0; i <= 1000; i++) {
      const t = i / 1000;
      expect(distance(100 * t, 200 * (1 - t) * t)).toBeLessThanOrEqual(0.015001);
    }
    expect(loop.length).toBeLessThan(4000);
  });

  it('detects tiny lost holes independently of polygon simplification and coverage area', () => {
    const source = new Uint8Array(100).fill(1),
      result = source.slice();
    source[44] = 0;
    expect(traceMaskTopology(source, 10)).toEqual({ components: 1, holes: 1 });
    expect(traceMaskTopology(result, 10)).toEqual({ components: 1, holes: 0 });
    expect(compareTraceMasks(source, result, 10, 4).intersectionOverUnion).toBeGreaterThan(0.98);
  });

  it('matches holes by position, so one lost and one spurious hole do not cancel out', () => {
    const width = 40,
      source = new Uint8Array(width * width),
      moved = source.slice();
    const square = (mask: Uint8Array, x0: number, y0: number, size: number, value: number) => {
      for (let y = y0; y < y0 + size; y++) for (let x = x0; x < x0 + size; x++) mask[y * width + x] = value;
    };
    square(source, 5, 5, 30, 1);
    square(moved, 5, 5, 30, 1);
    square(source, 10, 10, 4, 0);
    square(moved, 25, 25, 4, 0);
    expect(traceMaskTopology(source, width)).toEqual(traceMaskTopology(moved, width));
    expect(traceFeatureChanges(source, moved, width, 9)).toBe(2);
    // A merge of two filled regions across a gap is a change, as is a pinhole at or above the area threshold.
    const merged = source.slice();
    const split = source.slice();
    square(split, 20, 5, 2, 0);
    for (let y = 5; y < 35; y++) split[y * width + 20] = split[y * width + 21] = 0;
    expect(traceFeatureChanges(split, merged, width, 9)).toBeGreaterThan(0);
    const pinhole = source.slice();
    square(pinhole, 25, 25, 2, 0);
    expect(traceFeatureChanges(source, pinhole, width, 9)).toBe(0);
    expect(traceFeatureChanges(source, pinhole, width, 4)).toBe(1);
    expect(traceFeatureChanges(source, source, width, 9)).toBe(0);
  });

  it('fails the boundary check when a thin stroke loses its tip', () => {
    const width = 60,
      source = new Uint8Array(width * 20);
    for (let x = 5; x < 55; x++) source[10 * width + x] = source[11 * width + x] = 1;
    const result = source.slice();
    for (let x = 35; x < 55; x++) result[10 * width + x] = result[11 * width + x] = 0;
    expect(compareTraceMasks(source, result, width, 5).boundaryErrorPx).toBe(Infinity);
  });

  it('closes only light gaps up to two pixels wide', () => {
    const width = 20,
      ink = new Uint8Array(width * width).fill(1);
    for (let y = 0; y < width; y++) ink[y * width + 5] = ink[y * width + 6] = 0;
    for (let y = 0; y < width; y++) ink[y * width + 12] = ink[y * width + 13] = ink[y * width + 14] = 0;
    // The gap rows touching the grid edge open onto the outside and stay light.
    expect(closeTraceGaps(ink, width)).toBe(2 * (width - 2));
    expect(ink[3 * width + 5]).toBe(1);
    expect(ink[5]).toBe(0);
    expect(ink[3 * width + 13]).toBe(0);
  });

  it('measures boundary displacement in both directions rather than relying on area alone', () => {
    const source = new Uint8Array(100),
      shifted = new Uint8Array(100);
    for (let y = 2; y < 8; y++)
      for (let x = 2; x < 7; x++) {
        source[y * 10 + x] = 1;
        shifted[y * 10 + x + 1] = 1;
      }
    expect(compareTraceMasks(source, shifted, 10, 3).boundaryErrorPx).toBe(1);
  });

  it('terminates a pending smooth tracing worker on Stop and on its deadline', async () => {
    const workers: { terminate: ReturnType<typeof vi.fn> }[] = [];
    class FakeWorker {
      terminate = vi.fn();
      postMessage = vi.fn();
      constructor() {
        workers.push(this);
      }
    }
    vi.stubGlobal('Worker', FakeWorker);
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const stopped = smoothTrace(new Uint8Array(4), 2, 2, 1, 0.1, controller.signal);
      controller.abort();
      await expect(stopped).rejects.toMatchObject({ name: 'AbortError' });
      expect(workers[0].terminate).toHaveBeenCalledOnce();
      const timedOut = expect(smoothTrace(new Uint8Array(4), 2, 2, 1, 0.1)).rejects.toThrow('15 seconds');
      await vi.advanceTimersByTimeAsync(15_000);
      await timedOut;
      expect(workers[1].terminate).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
