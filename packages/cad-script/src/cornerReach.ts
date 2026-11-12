import { pointInPolygon, type CadPoint, type EvaluatedCadPart } from '@wbcnc/cad';

type Vec3 = [number, number, number];

/** How far a planned bit may stay from a corner and still be said to reach it, mm. */
const kReach = 0.01;
/** Corners this close to the part's outline or a neighbouring tool block aren't corners of the opening. */
const kEdge = 1e-3;

export interface CadCornerReach {
  /** The opening, by the part that cuts it, as the report's cuts name it. */
  ref: string;
  corners: number;
  /** Corners the bit's centre stays more than its radius from at the opening's floor. */
  unreached: number;
  /** How far the worst of them is out of reach, mm; absent when the bit doesn't cut that floor at all. */
  short?: number;
}

function segmentDistance(p: CadPoint, a: Vec3, b: Vec3): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / length)) : 0;
  return Math.hypot(p.x - a[0] - t * dx, p.y - a[1] - t * dy);
}

function outlineDistance(p: CadPoint, loop: readonly CadPoint[]): number {
  let nearest = Infinity;
  loop.forEach((a, i) => {
    const b = loop[(i + 1) % loop.length]!;
    nearest = Math.min(nearest, segmentDistance(p, [a.x, a.y, 0], [b.x, b.y, 0]));
  });
  return nearest;
}

/**
 * Whether the planned bit reaches the corners of the tool a "cut parts" step fits into each opening cut from the top.
 * A square tenon only seats when the bit's swept floor pass covers them: bones drawn in CAD aren't enough on their own.
 * `path` is the plan's feed moves in board coordinates, with z up from the board's underside; `toBoard` maps the part's
 * sketch coordinates onto it. Blind openings from the underside are planned on a second side and are left out; through
 * ones are cut from the top.
 */
export function cutPartsCornerReach(
  part: EvaluatedCadPart,
  path: readonly (readonly Vec3[])[],
  toBoard: (p: CadPoint) => CadPoint,
  bit: number,
  name: (cutId: string) => string
): CadCornerReach[] {
  const cuts = (part.cuts ?? []).filter(cut => cut.id.startsWith('cut-parts:') && cut.tool && (cut.side === 'top' || cut.through));
  const xs = part.outline.map(p => p.x),
    ys = part.outline.map(p => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return cuts.flatMap(cut => {
    const tool = cut.tool!;
    // The blocks of one tool are pieces `#n` of the same cut; where two meet, their shared corners lie inside the opening.
    const piece = cut.id.replace(/#\d+$/, '');
    // A shallower layer of a stepped tool doesn't hide the corners of a deeper one: only blocks at least as deep do.
    const neighbours = cuts
      .filter(other => other !== cut && other.id.replace(/#\d+$/, '') === piece && (other.through || other.to >= cut.to - kEdge))
      .map(other => other.tool!);
    const corners = [
      { x: tool.x0, y: tool.y0, sides: [tool.x0 > minX + kEdge, tool.y0 > minY + kEdge] },
      { x: tool.x1, y: tool.y0, sides: [tool.x1 < maxX - kEdge, tool.y0 > minY + kEdge] },
      { x: tool.x1, y: tool.y1, sides: [tool.x1 < maxX - kEdge, tool.y1 < maxY - kEdge] },
      { x: tool.x0, y: tool.y1, sides: [tool.x0 > minX + kEdge, tool.y1 < maxY - kEdge] },
    ].filter(
      corner =>
        // A side that runs off the part leaves that corner open.
        corner.sides.every(Boolean) &&
        pointInPolygon(corner, part.outline) &&
        outlineDistance(corner, part.outline) > kEdge &&
        // A corner in or on a profile hole is open there.
        !part.holes.some(hole => pointInPolygon(corner, hole) || outlineDistance(corner, hole) <= kEdge) &&
        !neighbours.some(
          box => corner.x >= box.x0 - kEdge && corner.x <= box.x1 + kEdge && corner.y >= box.y0 - kEdge && corner.y <= box.y1 + kEdge
        )
    );
    if (!corners.length) return [];
    // The floor pass is where the bit reaches the opening's full depth; through openings go below the board.
    const floor = cut.through ? 0 : part.thickness - cut.to;
    const atFloor: [Vec3, Vec3][] = [];
    for (const move of path)
      for (let i = 1; i < move.length; i++)
        if (Math.max(move[i - 1]![2], move[i]![2]) <= floor + kReach) atFloor.push([move[i - 1]!, move[i]!]);
    // A plan has many thousands of moves: no spreading them into Math.min, which overflows the call stack.
    const misses = corners.map(corner => {
      const p = toBoard(corner);
      let nearest = Infinity;
      for (const [a, b] of atFloor) nearest = Math.min(nearest, segmentDistance(p, a, b));
      return nearest - bit / 2;
    });
    const out = misses.filter(miss => miss > kReach);
    // A corner whose floor the bit never cuts has no distance; the others still say how far they miss.
    const finite = out.filter(Number.isFinite);
    const worst = !out.length ? 0 : finite.length ? Math.max(...finite) : undefined;
    return [
      {
        ref: name(cut.id),
        corners: corners.length,
        unreached: out.length,
        ...(worst !== undefined && { short: Math.round(worst * 100) / 100 }),
      },
    ];
  });
}
