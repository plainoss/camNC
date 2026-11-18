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
}

/** The chord a round's quarter circle may leave from the true curve, in mm, as CAD tessellates its curves. */
const kChordTolerance = 0.01;
/** How close, in mm, a mesh corner must be to a round's loop to be on it: Clipper keeps its paths to 1e-4 mm or so. */
const kOnLoop = 1e-3;

/** The heights the wall under a round is sliced at, so its quarter circle is drawn in steps of at most a chord. */
export function roundSlices(round: MeshRound): number[] {
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
      const inset = round.radius - Math.sqrt(Math.max(0, round.radius * round.radius - rise * rise));
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
  const miters = points.map((_, i) => {
    const a = normals[(i + n - 1) % n]!,
      b = normals[i]!;
    const scale = 1 + a.x * b.x + a.y * b.y;
    return scale > 1e-6 ? { x: (a.x + b.x) / scale, y: (a.y + b.y) / scale } : b;
  });
  return (x, y) => {
    let best: { distance: number; move: Point } | null = null;
    for (let i = 0; i < n; i++) {
      const p = points[i]!,
        q = points[(i + 1) % n]!;
      const dx = q.x - p.x,
        dy = q.y - p.y;
      const span = dx * dx + dy * dy;
      const t = span ? Math.max(0, Math.min(1, ((x - p.x) * dx + (y - p.y) * dy) / span)) : 0;
      const distance = Math.hypot(x - p.x - dx * t, y - p.y - dy * t);
      if (distance > kOnLoop || (best && distance >= best.distance)) continue;
      const along = t * Math.sqrt(span);
      const move = along < kOnLoop ? miters[i]! : Math.sqrt(span) - along < kOnLoop ? miters[(i + 1) % n]! : normals[i]!;
      best = { distance, move };
    }
    return best?.move ?? null;
  };
}
