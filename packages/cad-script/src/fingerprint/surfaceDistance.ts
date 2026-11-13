import { meshBbox, triangleNormal2A, vertex, type FingerprintMesh, type Vec3 } from './meshFingerprint';

/** A small seeded generator (mulberry32), so the same meshes always give the same samples. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function corners(mesh: FingerprintMesh, t: number): [Vec3, Vec3, Vec3] {
  return [vertex(mesh, mesh.indices[3 * t]!), vertex(mesh, mesh.indices[3 * t + 1]!), vertex(mesh, mesh.indices[3 * t + 2]!)];
}

/** `count` points spread over the surface by area, the same ones for the same mesh and seed. */
export function sampleSurface(mesh: FingerprintMesh, count: number, seed = 1): Vec3[] {
  const triangles = mesh.indices.length / 3,
    cumulative = new Float64Array(triangles);
  let total = 0;
  for (let t = 0; t < triangles; t++) {
    total += Math.hypot(...triangleNormal2A(...corners(mesh, t))) / 2;
    cumulative[t] = total;
  }
  if (!(total > 0)) return [];
  const next = random(seed);
  return Array.from({ length: count }, () => {
    const target = next() * total;
    let lo = 0,
      hi = triangles - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid]! < target) lo = mid + 1;
      else hi = mid;
    }
    const [a, b, c] = corners(mesh, lo);
    // Uniform over the triangle: the square root keeps points from bunching at the first corner.
    const r = Math.sqrt(next()),
      s = next();
    const u = 1 - r,
      v = r * (1 - s),
      w = r * s;
    return [u * a[0] + v * b[0] + w * c[0], u * a[1] + v * b[1] + w * c[1], u * a[2] + v * b[2] + w * c[2]];
  });
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Squared distance from p to the triangle abc, by the closest point's Voronoi region of the triangle. */
export function pointTriangleDistanceSq(p: Vec3, a: Vec3, b: Vec3, c: Vec3): number {
  const at = (q: Vec3) => dot(sub(p, q), sub(p, q));
  const along = (o: Vec3, d: Vec3, t: number): Vec3 => [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
  const ab = sub(b, a),
    ac = sub(c, a),
    ap = sub(p, a);
  const d1 = dot(ab, ap),
    d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return at(a);
  const bp = sub(p, b),
    d3 = dot(ab, bp),
    d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return at(b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return at(along(a, ab, d1 / (d1 - d3)));
  const cp = sub(p, c),
    d5 = dot(ab, cp),
    d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return at(c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return at(along(a, ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return at(along(b, sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6))));
  const denom = 1 / (va + vb + vc),
    v = vb * denom,
    w = vc * denom;
  return at([a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]);
}

/** Nearest distance from a point to a mesh's surface, through a uniform grid of the triangles' bounding boxes. */
export class SurfaceIndex {
  private readonly min: Vec3;
  private readonly size: number;
  private readonly cells: [number, number, number];
  private readonly grid = new Map<number, number[]>();
  private readonly triangles: [Vec3, Vec3, Vec3][];
  private readonly seen: Int32Array;
  private stamp = 0;

  constructor(mesh: FingerprintMesh) {
    this.triangles = Array.from({ length: mesh.indices.length / 3 }, (_, t) => corners(mesh, t));
    this.seen = new Int32Array(this.triangles.length);
    const box = meshBbox(mesh),
      extent = sub(box.max, box.min),
      longest = Math.max(...extent, 1e-6);
    // About one triangle per cell for an even mesh, and at most 128 cells along the longest side.
    const even = Math.cbrt(extent.reduce((volume, e) => volume * Math.max(e, longest / 128), 1) / Math.max(this.triangles.length, 1));
    this.size = Math.max(longest / 128, even);
    this.min = box.min;
    this.cells = extent.map(e => Math.max(1, Math.ceil(e / this.size))) as [number, number, number];
    this.triangles.forEach((triangle, t) => {
      const lo = [0, 1, 2].map(axis => this.cell(Math.min(...triangle.map(v => v[axis]!)), axis)),
        hi = [0, 1, 2].map(axis => this.cell(Math.max(...triangle.map(v => v[axis]!)), axis));
      for (let x = lo[0]!; x <= hi[0]!; x++)
        for (let y = lo[1]!; y <= hi[1]!; y++)
          for (let z = lo[2]!; z <= hi[2]!; z++) {
            const key = this.key(x, y, z);
            const list = this.grid.get(key);
            if (list) list.push(t);
            else this.grid.set(key, [t]);
          }
    });
  }

  private cell(value: number, axis: number) {
    return Math.min(this.cells[axis]! - 1, Math.max(0, Math.floor((value - this.min[axis]!) / this.size)));
  }
  private key(x: number, y: number, z: number) {
    return (x * this.cells[1] + y) * this.cells[2] + z;
  }

  /**
   * Searches growing shells of cells around the point's cell. Once the nearest triangle found is no farther than the
   * nearest face of the searched block that still has cells beyond it, nothing outside the block can be nearer.
   */
  distance(p: Vec3): number {
    if (!this.triangles.length) return Infinity;
    const stamp = ++this.stamp;
    const center = [0, 1, 2].map(axis => this.cell(p[axis]!, axis));
    let best = Infinity;
    for (let ring = 0; ; ring++) {
      const lo = center.map(c => c - ring),
        hi = center.map(c => c + ring);
      for (let x = Math.max(0, lo[0]!); x <= Math.min(this.cells[0] - 1, hi[0]!); x++)
        for (let y = Math.max(0, lo[1]!); y <= Math.min(this.cells[1] - 1, hi[1]!); y++)
          for (let z = Math.max(0, lo[2]!); z <= Math.min(this.cells[2] - 1, hi[2]!); z++) {
            // Only the shell is new: the cells inside it were searched at smaller rings.
            if (Math.max(Math.abs(x - center[0]!), Math.abs(y - center[1]!), Math.abs(z - center[2]!)) !== ring) continue;
            for (const t of this.grid.get(this.key(x, y, z)) ?? []) {
              if (this.seen[t] === stamp) continue;
              this.seen[t] = stamp;
              best = Math.min(best, pointTriangleDistanceSq(p, ...this.triangles[t]!));
            }
          }
      let bound = Infinity;
      for (let axis = 0; axis < 3; axis++) {
        if (lo[axis]! > 0) bound = Math.min(bound, p[axis]! - (this.min[axis]! + lo[axis]! * this.size));
        if (hi[axis]! < this.cells[axis]! - 1) bound = Math.min(bound, this.min[axis]! + (hi[axis]! + 1) * this.size - p[axis]!);
      }
      if (bound === Infinity || (bound > 0 && best <= bound * bound)) return Math.sqrt(best);
    }
  }
}

export interface DistanceStats {
  max: number;
  mean: number;
}

/** How far points sampled on `from` lie from the surface of `to`. */
export function surfaceDistance(from: FingerprintMesh, to: FingerprintMesh, samples = 20_000, seed = 1): DistanceStats {
  const index = new SurfaceIndex(to);
  const points = sampleSurface(from, samples, seed);
  let max = 0,
    sum = 0;
  for (const p of points) {
    const d = index.distance(p);
    max = Math.max(max, d);
    sum += d;
  }
  return { max, mean: points.length ? sum / points.length : 0 };
}
