import { describe, expect, it, vi } from 'vitest';
import { flattenCurveContours } from './curveFlatten';
import { smoothTrace } from './smoothTrace';
import { compareTraceMasks, traceMaskTopology } from './traceMetrics';
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
