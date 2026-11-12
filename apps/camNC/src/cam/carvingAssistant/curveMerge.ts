import type { CurveContour, CurveSegment } from './curveFlatten';

type Point = { x: number; y: number };

const kSamplesPerSegment = 8;
const kMaxRun = 24;

function cubicAt(s: CurveSegment, t: number): Point {
  const u = 1 - t;
  const a = u * u * u,
    b = 3 * u * u * t,
    c = 3 * u * t * t,
    d = t * t * t;
  return { x: a * s.x1 + b * s.x2 + c * s.x3! + d * s.x4!, y: a * s.y1 + b * s.y2 + c * s.y3! + d * s.y4! };
}

/**
 * One cubic through the run's endpoints, with its end tangents, fitted to points sampled along the run by least squares
 * on the two handle lengths over chord-length parameters. Returns it with its largest deviation from the samples at
 * those parameters (the raster checks measure the whole trace again), or null when the fit degenerates.
 */
function fitRun(run: CurveSegment[]): { segment: CurveSegment; error: number } | null {
  const first = run[0],
    last = run[run.length - 1];
  const p0 = { x: first.x1, y: first.y1 },
    p3 = { x: last.x4!, y: last.y4! };
  const t1 = { x: first.x2 - first.x1, y: first.y2 - first.y1 },
    t2 = { x: last.x3! - last.x4!, y: last.y3! - last.y4! };
  const l1 = Math.hypot(t1.x, t1.y),
    l2 = Math.hypot(t2.x, t2.y);
  if (l1 < 1e-9 || l2 < 1e-9) return null;
  t1.x /= l1;
  t1.y /= l1;
  t2.x /= l2;
  t2.y /= l2;
  const samples: Point[] = [p0];
  for (const s of run) for (let k = 1; k <= kSamplesPerSegment; k++) samples.push(cubicAt(s, k / kSamplesPerSegment));
  const lengths = [0];
  for (let i = 1; i < samples.length; i++)
    lengths.push(lengths[i - 1] + Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y));
  const total = lengths[lengths.length - 1];
  if (total < 1e-9) return null;
  // Least squares for the handle lengths a1, a2 (the standard tangent-constrained cubic fit).
  let c11 = 0,
    c12 = 0,
    c22 = 0,
    x1 = 0,
    x2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = lengths[i] / total,
      u = 1 - t;
    const b0 = u * u * u,
      b1 = 3 * u * u * t,
      b2 = 3 * u * t * t,
      b3 = t * t * t;
    const a1 = { x: t1.x * b1, y: t1.y * b1 },
      a2 = { x: t2.x * b2, y: t2.y * b2 };
    const rx = samples[i].x - (b0 + b1) * p0.x - (b2 + b3) * p3.x,
      ry = samples[i].y - (b0 + b1) * p0.y - (b2 + b3) * p3.y;
    c11 += a1.x * a1.x + a1.y * a1.y;
    c12 += a1.x * a2.x + a1.y * a2.y;
    c22 += a2.x * a2.x + a2.y * a2.y;
    x1 += a1.x * rx + a1.y * ry;
    x2 += a2.x * rx + a2.y * ry;
  }
  const det = c11 * c22 - c12 * c12;
  if (Math.abs(det) < 1e-12) return null;
  const alpha1 = (x1 * c22 - c12 * x2) / det,
    alpha2 = (c11 * x2 - c12 * x1) / det;
  // A negative or overlong handle makes a loop or cusp; keep the original segments.
  const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  if (!(alpha1 > 1e-6 && alpha2 > 1e-6) || Math.max(alpha1, alpha2) > Math.max(chord, total / 2)) return null;
  const segment: CurveSegment = {
    type: 'C',
    x1: p0.x,
    y1: p0.y,
    x2: p0.x + alpha1 * t1.x,
    y2: p0.y + alpha1 * t1.y,
    x3: p3.x + alpha2 * t2.x,
    y3: p3.y + alpha2 * t2.y,
    x4: p3.x,
    y4: p3.y,
    joinStyle: last.joinStyle,
  };
  let error = 0;
  for (let i = 0; i < samples.length; i++) {
    const p = cubicAt(segment, lengths[i] / total);
    error = Math.max(error, Math.hypot(p.x - samples[i].x, p.y - samples[i].y));
  }
  return { segment, error };
}

/**
 * Merge runs of cubics that meet with aligned tangents into fewer cubics, each within `tolerance` of the curve it
 * replaces. The pixel tracer starts a new segment wherever a contour's pixel direction changes class, about every 15
 * pixels on curved line art, so a smooth stroke took several times the segments it needs. Lines, sharp corners and
 * the end tangents of every run are kept, so joins stay as smooth or as sharp as before.
 */
export function mergeCurveRuns(paths: CurveContour[], tolerance: number): CurveContour[] {
  return paths.map(path => {
    const segments = path.segments;
    const n = segments.length;
    if (n < 3) return path;
    const mergeable = (s: CurveSegment) => s.type === 'C';
    // Join i is between segments i and i + 1; it ends a run when it is sharp or either side is not a cubic.
    const breaks = (i: number) => segments[i].joinStyle === 'sharp' || !mergeable(segments[i]) || !mergeable(segments[(i + 1) % n]);
    // Start just after a break, so no run wraps across one. A contour without any break starts at its first segment.
    let start = 0;
    for (let i = 0; i < n; i++)
      if (breaks(i)) {
        start = (i + 1) % n;
        break;
      }
    const out: CurveSegment[] = [];
    let at = 0;
    while (at < n) {
      const first = segments[(start + at) % n];
      if (!mergeable(first)) {
        out.push(first);
        at++;
        continue;
      }
      let best: CurveSegment = first,
        taken = 1;
      // Never the whole contour in one run: a closed loop's endpoints coincide, and one cubic cannot enclose an area.
      for (let length = 2; length <= Math.min(kMaxRun, n - 1) && at + length <= n; length++) {
        if (breaks((start + at + length - 2) % n)) break;
        const run = Array.from({ length }, (_, k) => segments[(start + at + k) % n]);
        const fit = fitRun(run);
        if (!fit || fit.error > tolerance) break;
        best = fit.segment;
        taken = length;
      }
      out.push(best);
      at += taken;
    }
    return { ...path, segments: out };
  });
}
