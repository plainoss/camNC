import type { CurveContour } from './curveFlatten';

/** Fit only contours already indistinguishable from an ellipse at source resolution, including pupils and holes. */
export function regularizeRoundTrace(paths: CurveContour[]): { paths: CurveContour[]; regularized: boolean } {
  let regularized = false;
  const fitted = paths.map((path): CurveContour => {
    const points = path.sourcePoints;
    if (!points?.length) return path;
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity,
      area = 0;
    for (let i = 0; i < points.length; i++) {
      const p = points[i],
        q = points[(i + 1) % points.length];
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
      area += p.x * q.y - q.x * p.y;
    }
    const rx = (x1 - x0) / 2,
      ry = (y1 - y0) / 2,
      cx = (x0 + x1) / 2,
      cy = (y0 + y1) / 2;
    if (Math.min(rx, ry) < 6 || Math.abs(Math.abs(area / 2) / (Math.PI * rx * ry) - 1) > 0.08) return path;
    for (const p of points) {
      const error = Math.abs(Math.hypot((p.x - cx) / rx, (p.y - cy) / ry) - 1) * Math.min(rx, ry);
      if (error > 1.5) return path;
    }
    // An independently checked near-ellipse gets an analytic four-cubic fit instead of a locally smooth dent.
    // The maximum radial error of this classic cubic ellipse is below 0.03% of its radius; raster coverage is checked again.
    const k = 0.5522847498307936;
    regularized = true;
    return {
      ...path,
      segments: [
        { type: 'C', x1: cx + rx, y1: cy, x2: cx + rx, y2: cy + k * ry, x3: cx + k * rx, y3: cy + ry, x4: cx, y4: cy + ry },
        { type: 'C', x1: cx, y1: cy + ry, x2: cx - k * rx, y2: cy + ry, x3: cx - rx, y3: cy + k * ry, x4: cx - rx, y4: cy },
        { type: 'C', x1: cx - rx, y1: cy, x2: cx - rx, y2: cy - k * ry, x3: cx - k * rx, y3: cy - ry, x4: cx, y4: cy - ry },
        { type: 'C', x1: cx, y1: cy - ry, x2: cx + k * rx, y2: cy - ry, x3: cx + rx, y3: cy - k * ry, x4: cx + rx, y4: cy },
      ],
    };
  });
  return { paths: fitted, regularized };
}
