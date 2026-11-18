import { polygonArea } from './geometry';
import type { CadDiagnostic, CadPart, CadPoint, EvaluatedCadPart } from './types';

/**
 * A closed outline moved out by `distance` mm, or in when it's negative: each side moves along its own normal and the
 * moved sides meet at sharp corners, as a wall drawn around a sketch's shape does.
 */
export function offsetOutline(points: CadPoint[], distance: number): CadPoint[] | null {
  // Outward is to the right of a counterclockwise walk.
  const turn = polygonArea(points) >= 0 ? 1 : -1;
  let sides = points.map((a, i) => {
    const b = points[(i + 1) % points.length]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = (turn * (b.y - a.y)) / length,
      ny = (-turn * (b.x - a.x)) / length;
    return { a: { x: a.x + nx * distance, y: a.y + ny * distance }, b: { x: b.x + nx * distance, y: b.y + ny * distance } };
  });
  // A side moved so far it turns round, as the short chords of an arc smaller than the wall do, is left out, and the
  // sides either side of it meet at a sharp corner instead. Once too few sides are left, no such wall can be made.
  for (;;) {
    const moved = corners(sides);
    if (!moved) return null;
    const kept = sides.filter((side, i) => {
      const p = moved[i]!,
        q = moved[(i + 1) % sides.length]!;
      return (q.x - p.x) * (side.b.x - side.a.x) + (q.y - p.y) * (side.b.y - side.a.y) >= -1e-9;
    });
    if (kept.length === sides.length)
      return selfCrossing(moved) || Math.sign(polygonArea(moved)) !== Math.sign(polygonArea(points)) ? null : moved;
    if (kept.length < 3) return null;
    sides = kept;
  }
}

type Side = { a: CadPoint; b: CadPoint };

/** Where each moved side meets the one before it, or null where two that are parallel lie apart and never meet. */
function corners(sides: Side[]): CadPoint[] | null {
  const n = sides.length;
  const moved: CadPoint[] = [];
  for (let i = 0; i < n; i++) {
    const side = sides[i]!,
      before = sides[(i + n - 1) % n]!;
    const d1 = { x: before.b.x - before.a.x, y: before.b.y - before.a.y },
      d2 = { x: side.b.x - side.a.x, y: side.b.y - side.a.y };
    const l1 = Math.hypot(d1.x, d1.y),
      l2 = Math.hypot(d2.x, d2.y);
    const cross = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(cross) < 1e-9 * l1 * l2) {
      // Sides in line, as along an arc drawn as short chords, meet where they already touch.
      const apart = Math.abs(((side.a.x - before.a.x) * d1.y - (side.a.y - before.a.y) * d1.x) / (l1 || 1));
      if (apart > 1e-6 || d1.x * d2.x + d1.y * d2.y < 0) return null;
      moved.push(side.a);
      continue;
    }
    const t = ((side.a.x - before.a.x) * d2.y - (side.a.y - before.a.y) * d2.x) / cross;
    moved.push({ x: before.a.x + d1.x * t, y: before.a.y + d1.y * t });
  }
  return moved;
}

/** Whether two sides of an outline that don't meet at a corner cross each other. */
function selfCrossing(points: CadPoint[]): boolean {
  const n = points.length;
  const side = (p: CadPoint, q: CadPoint, r: CadPoint) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const a = points[i]!,
        b = points[(i + 1) % n]!,
        c = points[j]!,
        d = points[(j + 1) % n]!;
      if (side(a, b, c) * side(a, b, d) < -1e-12 && side(c, d, a) * side(c, d, b) < -1e-12) return true;
    }
  return false;
}

/**
 * A thin extrude's walls: the picked shape's outline as a ring, Thickness 1 out from it and Thickness 2 in, or both
 * halves of Thickness 1 either side with Mid plane. The shape's own holes are left out: the ring has no floor.
 */
export function thinWallShape(part: CadPart, shape: EvaluatedCadPart): { part?: EvaluatedCadPart; diagnostics: CadDiagnostic[] } {
  const wall = part.thinWall!;
  const out = wall.midPlane ? wall.thickness1 / 2 : wall.thickness1;
  const inward = wall.midPlane ? wall.thickness1 / 2 : wall.thickness2;
  const outer = out > 0 ? offsetOutline(shape.outline, out) : shape.outline;
  const inner = inward > 0 ? offsetOutline(shape.outline, -inward) : shape.outline;
  if (!outer || !inner)
    return {
      diagnostics: [
        { code: 'thin-wall', severity: 'error', partId: part.id, message: 'The wall is too thick for this shape. Make it thinner.' },
      ],
    };
  const id = shape.loops.find(loop => loop.kind === 'outer')?.id ?? `${part.id}:profile`;
  const entityIds = shape.loops.find(loop => loop.kind === 'outer')?.entityIds ?? [];
  const made: EvaluatedCadPart = {
    ...shape,
    outline: outer,
    holes: [inner],
    loops: [
      { id: `${id}:thin-outer`, entityIds, points: outer, kind: 'outer' },
      { id: `${id}:thin-inner`, entityIds, points: inner, kind: 'hole' },
    ],
  };
  return { part: made, diagnostics: [] };
}
