export interface CurveSegment {
  type: 'L' | 'Q' | 'C';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3?: number;
  y3?: number;
  x4?: number;
  y4?: number;
  joinStyle?: 'sharp' | 'micro' | 'gentle';
}
export interface CurveContour {
  segments: CurveSegment[];
  isholepath: boolean;
  sourcePoints?: { x: number; y: number }[];
}
type Point = { x: number; y: number };

/** Adaptive de Casteljau subdivision. Quadratic deviation from the endpoint chord is at most half its control distance. */
export function flattenCurveContours(paths: CurveContour[], tolerance: number, maxPoints = 8000): Point[][] {
  let count = 0;
  const distance = (p: Point, a: Point, b: Point) => {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  };
  return paths.map(path => {
    const first = path.segments[0];
    const points: Point[] = [{ x: first.x1, y: first.y1 }];
    const add = (point: Point) => {
      if (++count > maxPoints) throw new Error('Smooth curve CAM approximation exceeds its point budget.');
      points.push(point);
    };
    for (const segment of path.segments) {
      if (segment.type === 'L') {
        add({ x: segment.x2, y: segment.y2 });
        continue;
      }
      if (segment.x3 === undefined || segment.y3 === undefined) throw new Error('Invalid quadratic curve.');
      if (segment.type === 'C') {
        if (segment.x4 === undefined || segment.y4 === undefined) throw new Error('Invalid cubic curve.');
        const stack = [
          {
            a: { x: segment.x1, y: segment.y1 },
            c: { x: segment.x2, y: segment.y2 },
            d: { x: segment.x3, y: segment.y3 },
            b: { x: segment.x4, y: segment.y4 },
            depth: 0,
          },
        ];
        while (stack.length) {
          const { a, c, d, b, depth } = stack.pop()!;
          if (Math.max(distance(c, a, b), distance(d, a, b)) <= tolerance) {
            add(b);
            continue;
          }
          if (depth > 16) throw new Error('Cubic flattening exceeded its subdivision budget.');
          const mid = (p: Point, q: Point) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
          const ac = mid(a, c),
            cd = mid(c, d),
            db = mid(d, b),
            left = mid(ac, cd),
            right = mid(cd, db),
            center = mid(left, right);
          stack.push({ a: center, c: right, d: db, b, depth: depth + 1 }, { a, c: ac, d: left, b: center, depth: depth + 1 });
        }
        continue;
      }
      const stack = [
        { a: { x: segment.x1, y: segment.y1 }, c: { x: segment.x2, y: segment.y2 }, b: { x: segment.x3, y: segment.y3 }, depth: 0 },
      ];
      while (stack.length) {
        const { a, c, b, depth } = stack.pop()!;
        if (distance(c, a, b) <= tolerance * 2) {
          add(b);
          continue;
        }
        if (depth > 16) throw new Error('Curve flattening exceeded its subdivision budget.');
        const ac = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 },
          cb = { x: (c.x + b.x) / 2, y: (c.y + b.y) / 2 };
        const mid = { x: (ac.x + cb.x) / 2, y: (ac.y + cb.y) / 2 };
        stack.push({ a: mid, c: cb, b, depth: depth + 1 }, { a, c: ac, b: mid, depth: depth + 1 });
      }
    }
    if (Math.hypot(points.at(-1)!.x - points[0].x, points.at(-1)!.y - points[0].y) < 1e-6) points.pop();
    const area = points.reduce((sum, p, i) => {
      const q = points[(i + 1) % points.length];
      return sum + p.x * q.y - q.x * p.y;
    }, 0);
    // Pixel Y points down. Reverse here so converting to physical Y-up gives CAM's positive outer winding.
    return Math.sign(area) === (path.isholepath ? 1 : -1) ? points : points.reverse();
  });
}
