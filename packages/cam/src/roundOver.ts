type Point = { x: number; y: number };

/** An edge of a part's solid rounded over, in the mesh's frame: its loop at height `z`, the round going down or up. */
export interface MeshRound {
  points: Point[];
  /** The edge's height: the part's top, or a pocket's floor, for one on the top; its underside, or a floor there. */
  z: number;
  /** The material is below the edge, as on the top; above it on the underside. */
  down: boolean;
  radius: number;
  /** Where the material is: inside the loop for an outline, outside it for a hole or a pocket's opening. */
  material: 'inside' | 'outside';
  /** Cut off at 45° instead of rounded: `radius` is the distance it takes off the face and off the wall. */
  chamfer?: true;
  /** Only these stretches of the loop are treated, each from one point to another on it; the rest stay sharp. */
  edges?: [Point, Point][];
}

/** The chord a round's quarter circle may leave from the true curve, in mm, as CAD tessellates its curves. */
const kChordTolerance = 0.01;
/** How close, in mm, a mesh corner must be to a round's loop to be on it: Clipper keeps its paths to 1e-4 mm or so. */
const kOnLoop = 1e-3;

/** The heights the wall under a round is sliced at, so its quarter circle is drawn in steps of at most a chord. */
export function roundSlices(round: MeshRound): number[] {
  // A chamfer is one flat face, from its foot on the wall up to the edge.
  if (round.chamfer) return [round.z + (round.down ? -1 : 1) * round.radius];
  const step = 2 * Math.acos(Math.max(-1, 1 - kChordTolerance / round.radius));
  const count = Math.max(4, Math.min(32, Math.ceil(Math.PI / 2 / step)));
  // From where the round leaves the wall, at its foot, up to just short of the edge, which is a height already.
  return Array.from({ length: count }, (_, i) => {
    const angle = (i * Math.PI) / 2 / count;
    return round.z + (round.down ? -1 : 1) * round.radius * (1 - Math.sin(angle));
  });
}

/**
 * Moves a mesh's corners on rounded edges onto their round: a corner of the loop at the edge's height moves in by the
 * radius, along the face, and one on the wall below moves in as far as the quarter circle there says, so the walls'
 * slices from {@link roundSlices} curve over into the face. Each loop moves with its own sides kept parallel, as an
 * offset does; a corner's miter keeps both of its sides at the distance.
 */
export function roundOver(positions: Float64Array, rounds: readonly MeshRound[]): void {
  if (!rounds.length) return;
  const move = roundMover(rounds);
  for (let i = 0; i < positions.length; i += 3) {
    const moved = move(positions[i]!, positions[i + 1]!, positions[i + 2]!);
    if (!moved) continue;
    positions[i] = moved.x;
    positions[i + 1] = moved.y;
  }
}

/**
 * Where a point of the sharp solid goes on the rounds, as {@link roundOver} moves it, or null for one on no round: off
 * their loops, or above or below where they curve.
 */
export function roundMover(rounds: readonly MeshRound[]): (x: number, y: number, z: number) => Point | null {
  const moves = rounds.map(loopMoves);
  return (x, y, z) => {
    for (let r = 0; r < rounds.length; r++) {
      const round = rounds[r]!;
      // How far below the edge, into the wall, for one on the top: 0 at the edge, the radius where the round ends.
      const depth = round.down ? round.z - z : z - round.z;
      if (depth < -1e-9 || depth > round.radius + 1e-9) continue;
      const move = moves[r]!(x, y);
      if (!move) continue;
      const rise = round.radius - Math.min(round.radius, depth);
      const inset = round.chamfer ? rise : round.radius - Math.sqrt(Math.max(0, round.radius * round.radius - rise * rise));
      return { x: x + move.x * inset, y: y + move.y * inset };
    }
    return null;
  };
}

/** For a point on the round's loop, the way into the material that moves it one unit off each side it's on. */
function loopMoves(round: MeshRound): (x: number, y: number) => Point | null {
  const points = round.points;
  const n = points.length;
  const area = points.reduce((sum, p, i) => sum + p.x * points[(i + 1) % n]!.y - points[(i + 1) % n]!.x * p.y, 0);
  // Into the material: to the left of a counterclockwise outline, to the right of a counterclockwise hole.
  const sign = area > 0 === (round.material === 'inside') ? 1 : -1;
  const normals = points.map((p, i) => {
    const q = points[(i + 1) % n]!;
    const length = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    return { x: (-(q.y - p.y) / length) * sign, y: ((q.x - p.x) / length) * sign };
  });
  const treated = points.map((p, i) => !round.edges || round.edges.some(edge => onStretch(p, points[(i + 1) % n]!, edge)));
  const along = (i: number, from: Point, to: Point) => {
    // Along an untreated side, out of the corner, as far as puts it a unit in from the treated side's line.
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const d = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
    const square = d.x * normals[i]!.x + d.y * normals[i]!.y;
    return square > 1e-6 ? { x: d.x / square, y: d.y / square } : normals[i]!;
  };
  const miters = points.map((p, i) => {
    const before = (i + n - 1) % n;
    if (!treated[before] && treated[i]) return along(i, p, points[before]!);
    if (treated[before] && !treated[i]) return along(before, p, points[(i + 1) % n]!);
    const a = normals[before]!,
      b = normals[i]!;
    const scale = 1 + a.x * b.x + a.y * b.y;
    return scale > 1e-6 ? { x: (a.x + b.x) / scale, y: (a.y + b.y) / scale } : b;
  });
  return (x, y) => {
    let best: { distance: number; move: Point | null } | null = null;
    for (let i = 0; i < n; i++) {
      const p = points[i]!,
        q = points[(i + 1) % n]!;
      const dx = q.x - p.x,
        dy = q.y - p.y;
      const span = dx * dx + dy * dy;
      const t = span ? Math.max(0, Math.min(1, ((x - p.x) * dx + (y - p.y) * dy) / span)) : 0;
      const distance = Math.hypot(x - p.x - dx * t, y - p.y - dy * t);
      if (distance > kOnLoop || (best && distance >= best.distance)) continue;
      const at = t * Math.sqrt(span);
      const corner = at < kOnLoop ? i : Math.sqrt(span) - at < kOnLoop ? (i + 1) % n : -1;
      const sharp = corner < 0 ? !treated[i] : !treated[(corner + n - 1) % n] && !treated[corner];
      best = { distance, move: sharp ? null : corner < 0 ? normals[i]! : miters[corner]! };
    }
    return best?.move ?? null;
  };
}

/** Whether a side of a loop lies along a treated stretch: its middle on the stretch, square to it within a hair. */
function onStretch(p: Point, q: Point, [a, b]: [Point, Point]): boolean {
  const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const span = dx * dx + dy * dy;
  if (!span) return false;
  const t = ((m.x - a.x) * dx + (m.y - a.y) * dy) / span;
  const off = Math.abs((m.x - a.x) * dy - (m.y - a.y) * dx) / Math.sqrt(span);
  const cross = Math.abs((q.x - p.x) * dy - (q.y - p.y) * dx) / Math.sqrt(span);
  return t > -1e-9 && t < 1 + 1e-9 && off < kOnLoop && cross < kOnLoop * Math.max(1, Math.hypot(q.x - p.x, q.y - p.y));
}
