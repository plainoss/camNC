import type { CurveContour, CurveSegment } from './curveFlatten';

/** Convert quadratics exactly to cubics, then align handles at gentle joins. Straight book edges and sharp corners stay. */
export function smoothCurveJoins(paths: CurveContour[], maxControlMove = 0.5, microSpan = 0): CurveContour[] {
  return paths.map(path => {
    const originalSpans = path.segments.map(s => {
      const xs = [s.x1, s.x2, ...(s.x3 === undefined ? [] : [s.x3]), ...(s.x4 === undefined ? [] : [s.x4])];
      const ys = [s.y1, s.y2, ...(s.y3 === undefined ? [] : [s.y3]), ...(s.y4 === undefined ? [] : [s.y4])];
      return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    });
    let segments: CurveSegment[] = path.segments.map(segment =>
      segment.type === 'Q'
        ? {
            type: 'C',
            x1: segment.x1,
            y1: segment.y1,
            x2: segment.x1 + (2 / 3) * (segment.x2 - segment.x1),
            y2: segment.y1 + (2 / 3) * (segment.y2 - segment.y1),
            x3: segment.x3! + (2 / 3) * (segment.x2 - segment.x3!),
            y3: segment.y3! + (2 / 3) * (segment.y2 - segment.y3!),
            x4: segment.x3,
            y4: segment.y3,
          }
        : { ...segment }
    );
    segments = segments.map((s, i) =>
      s.type === 'L' && originalSpans[i] <= microSpan
        ? {
            type: 'C',
            x1: s.x1,
            y1: s.y1,
            x2: s.x1 + (s.x2 - s.x1) / 3,
            y2: s.y1 + (s.y2 - s.y1) / 3,
            x3: s.x1 + (2 * (s.x2 - s.x1)) / 3,
            y3: s.y1 + (2 * (s.y2 - s.y1)) / 3,
            x4: s.x2,
            y4: s.y2,
          }
        : s
    );
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i],
        next = segments[(i + 1) % segments.length];
      const incoming = s.type === 'C' ? [next.x1 - s.x3!, next.y1 - s.y3!] : [next.x1 - s.x1, next.y1 - s.y1];
      const outgoing = [next.x2 - next.x1, next.y2 - next.y1];
      const length = Math.hypot(...incoming) * Math.hypot(...outgoing);
      const dot = length ? (incoming[0] * outgoing[0] + incoming[1] * outgoing[1]) / length : -1;
      // Decide from ORIGINAL spans before any subdivision. A long intentional corner must never become
      // eligible merely because another join caused its neighboring segment to be split into small pieces.
      s.joinStyle =
        originalSpans[i] <= microSpan && originalSpans[(i + 1) % segments.length] <= microSpan && dot > Math.cos((170 * Math.PI) / 180)
          ? 'micro'
          : dot < Math.cos((55 * Math.PI) / 180)
            ? 'sharp'
            : 'gentle';
    }
    const direction = (before: CurveSegment, after: CurveSegment) => {
      if (before.type === 'L' && after.type === 'L') return null;
      if (before.joinStyle === 'sharp') return null;
      const x = after.x1,
        y = after.y1;
      const incoming = before.type === 'C' ? [x - before.x3!, y - before.y3!] : [x - before.x1, y - before.y1];
      const outgoing = [after.x2 - x, after.y2 - y];
      const a = Math.hypot(...incoming),
        b = Math.hypot(...outgoing);
      if (a < 1e-8 || b < 1e-8) return null;
      const dot = (incoming[0] * outgoing[0] + incoming[1] * outgoing[1]) / (a * b);
      if (dot < Math.cos(((before.joinStyle === 'micro' ? 170 : 55) * Math.PI) / 180)) return null;
      let dx = incoming[0] / a + outgoing[0] / b,
        dy = incoming[1] / a + outgoing[1] / b;
      if (before.type === 'L') {
        dx = incoming[0] / a;
        dy = incoming[1] / a;
      }
      if (after.type === 'L') {
        dx = outgoing[0] / b;
        dy = outgoing[1] / b;
      }
      const length = Math.hypot(dx, dy);
      dx /= length;
      dy /= length;
      return { x, y, a, b, dx, dy };
    };
    const split = (s: CurveSegment): CurveSegment[] => {
      const mid = (a: number, b: number) => (a + b) / 2;
      const ax = mid(s.x1, s.x2),
        ay = mid(s.y1, s.y2),
        bx = mid(s.x2, s.x3!),
        by = mid(s.y2, s.y3!),
        cx = mid(s.x3!, s.x4!),
        cy = mid(s.y3!, s.y4!);
      const dx = mid(ax, bx),
        dy = mid(ay, by),
        ex = mid(bx, cx),
        ey = mid(by, cy),
        x = mid(dx, ex),
        y = mid(dy, ey);
      return [
        { type: 'C', x1: s.x1, y1: s.y1, x2: ax, y2: ay, x3: dx, y3: dy, x4: x, y4: y, joinStyle: 'gentle' },
        { type: 'C', x1: x, y1: y, x2: ex, y2: ey, x3: cx, y3: cy, x4: s.x4, y4: s.y4, joinStyle: s.joinStyle },
      ];
    };
    // Long handles can move many pixels when their tangents are aligned. Subdivide first, without changing the
    // original curve, until each subsequent handle adjustment is physically bounded.
    for (let pass = 0; pass < 12; pass++) {
      const subdivide = new Set<number>();
      for (let i = 0; i < segments.length; i++) {
        const next = (i + 1) % segments.length,
          before = segments[i],
          after = segments[next],
          join = direction(before, after);
        if (!join) continue;
        const { x, y, a, b, dx, dy } = join;
        if (before.type === 'C' && Math.hypot(before.x3! - (x - a * dx), before.y3! - (y - a * dy)) > maxControlMove) subdivide.add(i);
        if (after.type === 'C' && Math.hypot(after.x2 - (x + b * dx), after.y2 - (y + b * dy)) > maxControlMove) subdivide.add(next);
      }
      if (!subdivide.size) break;
      segments = segments.flatMap((segment, i) => (subdivide.has(i) ? split(segment) : [segment]));
      if (segments.length > 2000) throw new Error('Smooth tangent fitting exceeds its segment budget.');
      if (pass === 11) throw new Error('Smooth tangent fitting exceeded its refinement budget.');
    }
    for (let i = 0; i < segments.length; i++) {
      const before = segments[i],
        after = segments[(i + 1) % segments.length];
      const join = direction(before, after);
      if (!join) continue;
      const { x, y, a, b, dx, dy } = join;
      if (before.type === 'C') {
        before.x3 = x - a * dx;
        before.y3 = y - a * dy;
      }
      if (after.type === 'C') {
        after.x2 = x + b * dx;
        after.y2 = y + b * dy;
      }
    }
    return { ...path, segments };
  });
}
