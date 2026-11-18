import { pointInPolygon } from './geometry';
import type { CadDiagnostic, CadFilletRim, CadPart, CadPoint, EvaluatedCadCut, EvaluatedCadPart, EvaluatedCadRound } from './types';

/**
 * An edge along a face of a part that a Fillet can round over: where its top or underside, or a pocket's floor, meets a
 * wall going into the part.
 */
export interface CadRimLoop {
  /** `outline`, a through hole's loop ID, or a cut's ID for its opening. */
  id: string;
  side: 'top' | 'underside';
  /** mm in from that side's surface where the edge sits: 0 on the surface itself, a cut's floor depth for one on it. */
  at: number;
  points: CadPoint[];
  /** Where the part's material is: inside the loop for its outline, outside it for a hole or a cut's opening. */
  material: 'inside' | 'outside';
  /** How far the wall below the edge goes into the part: a round can't be any bigger. */
  wall: number;
}

/** A Fillet step whose rounds along the part's faces don't all fit: why, and the edges it leaves sharp. */
export interface CadEdgeRoundProblem {
  filletId: string;
  message: string;
  edges: { loopId: string; side: 'top' | 'underside' }[];
  /** The biggest radius that would fit, when the radius is what's in the way. */
  maximumRadius?: number;
}

const kTolerance = 1e-3;
/** Points a loop is measured at for how narrow it gets: enough for a few hundredths of a mm on parts up to a metre. */
const kWidthSamples = 400;
/** How close, in mm, a picked mesh edge must lie to a loop to be on it: the mesh and the loop are tessellated alike. */
const kPickTolerance = 0.05;

const sides = ['top', 'underside'] as const;

/**
 * The edges along a part's faces a Fillet can round: its outline and through holes, on both sides, and each cut's
 * opening, with a through cut's on both. An opening inside another cut's opening sits on that cut's floor, as a
 * counterbore's hole does. A cut that runs out to the part's outline, as a rabbet does, has no closed opening, and the
 * outline's edge on that side is cut away in places too, so neither is offered.
 */
export function rimLoops(part: EvaluatedCadPart): CadRimLoop[] {
  const cuts = part.cuts ?? [];
  const onOutline = (p: CadPoint) => distanceToLoop(p, part.outline) < kTolerance;
  const open = new Set(
    cuts.filter(cut =>
      cut.outline.some((p, i) => {
        const q = cut.outline[(i + 1) % cut.outline.length]!;
        return (!pointInPolygon(p, part.outline) && !onOutline(p)) || onOutline({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
      })
    )
  );
  const closed = cuts.filter(cut => !open.has(cut));
  const loops: CadRimLoop[] = [];
  /** A loop's edge on a side: on the face itself, or on the floor of the deepest cut whose opening holds it. */
  const place = (id: string, points: CadPoint[], side: 'top' | 'underside', bottom: number, self?: EvaluatedCadCut) => {
    const holding = closed.filter(
      other => other !== self && other.side === side && !other.through && other.from === 0 && encloses(other.outline, points)
    );
    const at = Math.max(self && self.side === side ? self.from : 0, ...holding.map(other => other.to));
    if (at < bottom - kTolerance) loops.push({ id, side, at, points, material: 'outside', wall: bottom - at });
  };
  for (const side of sides) {
    if (![...open].some(cut => cut.side === side && cut.from === 0))
      loops.push({ id: 'outline', side, at: 0, points: part.outline, material: 'inside', wall: part.thickness });
    for (const loop of part.loops) if (loop.kind === 'hole') place(loop.id, loop.points, side, part.thickness);
  }
  for (const cut of closed) {
    place(cut.id, cut.outline, cut.side, cut.through ? part.thickness : cut.to, cut);
    if (cut.through) place(cut.id, cut.outline, cut.side === 'top' ? 'underside' : 'top', part.thickness, cut);
  }
  return loops;
}

/** Whether every point of `inner` is inside `outer`, or on it. */
function encloses(outer: CadPoint[], inner: CadPoint[]): boolean {
  return inner.every(p => pointInPolygon(p, outer) || distanceToLoop(p, outer) < kTolerance);
}

/**
 * The edges of the face a click at `point` lands on, on that side's surface: the outline and every hole and cut opening
 * in it. A pocket's floor is refused, as its edges where it meets the walls are inside edges a router can't round.
 */
export function faceRims(part: EvaluatedCadPart, side: 'top' | 'underside', point: CadPoint): CadFilletRim | { error: string } {
  const all = rimLoops(part).filter(loop => loop.side === side && loop.at === 0);
  const outline = all.find(loop => loop.id === 'outline');
  if (!outline) return { error: 'That face runs out to the part’s edge: pick its edges one by one.' };
  if (!pointInPolygon(point, outline.points)) return { error: 'Click a face of a part.' };
  const inner = all.filter(loop => loop.id !== 'outline');
  if (inner.some(loop => pointInPolygon(point, loop.points))) return { error: 'That face is inside a cut: pick its edges one by one.' };
  return { side, loops: ['outline', ...inner.map(loop => loop.id)], face: true };
}

/**
 * The loop a picked edge of the part's mesh lies along, end `a` to end `b` in the part's own frame, with its thickness
 * as z. An edge through the part's thickness isn't on one; nor is an inside edge, where a pocket's floor meets its wall.
 */
export function rimAt(
  part: EvaluatedCadPart,
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): { loopId: string; side: 'top' | 'underside' } | { error: string } {
  if (Math.abs(a[2] - b[2]) > kTolerance) return { error: 'That edge runs through the part, not along one of its faces.' };
  const z = (a[2] + b[2]) / 2;
  const middle = { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 };
  const on = (loop: CadRimLoop) => Math.abs((loop.side === 'top' ? part.thickness - loop.at : loop.at) - z) < kTolerance;
  const near = (points: CadPoint[]) => distanceToLoop(middle, points) < kPickTolerance;
  const found = rimLoops(part)
    .filter(loop => on(loop) && near(loop.points))
    .sort((p, q) => distanceToLoop(middle, p.points) - distanceToLoop(middle, q.points))[0];
  if (found) return { loopId: found.id, side: found.side };
  const floor = (part.cuts ?? []).some(
    cut => !cut.through && Math.abs((cut.side === 'top' ? part.thickness - cut.to : cut.to) - z) < kTolerance && near(cut.outline)
  );
  return {
    error: floor
      ? 'That’s an inside edge, where a pocket’s floor meets its wall: only outside edges can be rounded over.'
      : 'That edge isn’t along a face the part’s edges can be rounded on.',
  };
}

/**
 * A part's Fillet steps along its faces, in order: each rounds over its loops to its radius. A loop that's gone, or
 * that the radius doesn't fit, is left sharp and the step says why; the rest are still rounded. A round can't be bigger
 * than the wall below it, and two on one face, or one across a narrow part, can't overlap.
 */
export function withEdgeRounds(
  source: CadPart,
  part: EvaluatedCadPart
): { part: EvaluatedCadPart; diagnostics: CadDiagnostic[]; problems: CadEdgeRoundProblem[] } {
  const fillets = (source.fillets ?? []).filter(fillet => !fillet.suppressed && fillet.rims?.length);
  if (!fillets.length) return { part, diagnostics: [], problems: [] };
  const loops = rimLoops(part);
  const rounds: EvaluatedCadRound[] = [];
  const diagnostics: CadDiagnostic[] = [];
  const problems: CadEdgeRoundProblem[] = [];
  const key = (loopId: string, side: string) => `${side}\n${loopId}`;
  for (const fillet of fillets) {
    const wanted = [
      ...new Map(
        fillet.rims!.flatMap(rim => rim.loops.map(loopId => [key(loopId, rim.side), { loopId, side: rim.side }] as const))
      ).values(),
    ];
    const reasons: string[] = [];
    const sharp: CadEdgeRoundProblem['edges'] = [];
    let maximumRadius: number | undefined;
    const refuse = (edge: CadEdgeRoundProblem['edges'][number], reason: string, fits?: number) => {
      sharp.push(edge);
      if (!reasons.includes(reason)) reasons.push(reason);
      if (fits !== undefined) maximumRadius = Math.min(maximumRadius ?? Infinity, Math.max(0, fits));
    };
    const r = fillet.radius;
    const found: CadRimLoop[] = [];
    for (const edge of wanted) {
      const loop = loops.find(candidate => candidate.id === edge.loopId && candidate.side === edge.side);
      if (!loop) refuse(edge, 'an edge it rounds is gone.');
      else if (rounds.some(round => round.loopId === loop.id && round.side === loop.side))
        refuse(edge, 'an edge it rounds is already rounded by an earlier fillet.');
      else found.push(loop);
    }
    // Each edge is checked against the walls and faces around it, with this step's other rounds and earlier ones.
    // On a pocket's floor, the pocket's own wall bounds the face too, as a counterbore's does around its hole.
    const others = (loop: CadRimLoop) => [
      ...loops.filter(other => other !== loop && other.side === loop.side && Math.abs(other.at - loop.at) < kTolerance),
      ...(part.cuts ?? [])
        .filter(cut => loop.at > 0 && cut.side === loop.side && !cut.through && Math.abs(cut.to - loop.at) < kTolerance)
        .filter(cut => encloses(cut.outline, loop.points))
        .map((cut): CadRimLoop => ({ ...loop, id: `${cut.id}:floor`, points: cut.outline })),
    ];
    // A round must fit its own wall and the part's width first; those that do are then checked against each other.
    const fitting = found.filter(loop => {
      const edge = { loopId: loop.id, side: loop.side };
      if (r > loop.wall + kTolerance) {
        refuse(edge, `a ${fmt(r)} mm round is more than the ${fmt(loop.wall)} mm wall below an edge.`, loop.wall);
        return false;
      }
      const across = selfWidth(loop);
      if (across < 2 * r - kTolerance) {
        refuse(edge, `two ${fmt(r)} mm rounds would overlap across the part’s ${fmtWidth(across)} mm width.`, across / 2);
        return false;
      }
      return true;
    });
    const roundOn = (other: CadRimLoop) =>
      fitting.includes(other) ? r : rounds.find(round => round.loopId === other.id && round.side === other.side)?.radius;
    const kept = fitting.filter(loop => {
      const edge = { loopId: loop.id, side: loop.side };
      for (const other of others(loop)) {
        const beside = roundOn(other) ?? 0;
        const width = loopDistance(loop.points, other.points, r + beside);
        if (r + beside > width + kTolerance) {
          refuse(
            edge,
            beside
              ? `rounds of ${fmt(r)} and ${fmt(beside)} mm would overlap on a ${fmtWidth(width)} mm wide face.`
              : `a ${fmt(r)} mm round doesn’t fit on a ${fmtWidth(width)} mm wide face.`,
            width - beside
          );
          return false;
        }
      }
      return true;
    });
    for (const loop of kept)
      rounds.push({
        filletId: fillet.id,
        loopId: loop.id,
        side: loop.side,
        at: loop.at,
        radius: r,
        points: loop.points,
        material: loop.material,
      });
    if (!sharp.length) continue;
    const some = kept.length ? ` at ${sharp.length} of its ${wanted.length} edges` : '';
    const why = reasons.map((text, i) => (i ? text[0]!.toUpperCase() + text.slice(1) : text)).join(' ');
    const message = `A fillet on ${part.name} can’t be made${some}: ${why}`;
    problems.push({ filletId: fillet.id, message, edges: sharp, ...(maximumRadius !== undefined && { maximumRadius }) });
    diagnostics.push({ code: 'fillet-round-unresolved', severity: 'warning', partId: source.id, message, entityIds: [fillet.id] });
  }
  return { part: rounds.length ? { ...part, rounds } : part, diagnostics, problems };
}

const fmt = (value: number) => `${+value.toFixed(2)}`;
/** A width measured between tessellated curves, which run up to a chord's sag inside them: to a tenth of a mm. */
const fmtWidth = (value: number) => `${+value.toFixed(1)}`;

function distanceToSegment(p: CadPoint, a: CadPoint, b: CadPoint): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const span = dx * dx + dy * dy;
  const t = span ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / span)) : 0;
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}

function distanceToLoop(p: CadPoint, loop: CadPoint[]): number {
  let best = Infinity;
  for (let i = 0; i < loop.length; i++) best = Math.min(best, distanceToSegment(p, loop[i]!, loop[(i + 1) % loop.length]!));
  return best;
}

/** The least distance between two loops that don't cross, or anything at least `enough` when they're further apart. */
function loopDistance(a: CadPoint[], b: CadPoint[], enough: number): number {
  const box = (points: CadPoint[]) => ({
    x0: Math.min(...points.map(p => p.x)),
    y0: Math.min(...points.map(p => p.y)),
    x1: Math.max(...points.map(p => p.x)),
    y1: Math.max(...points.map(p => p.y)),
  });
  const p = box(a),
    q = box(b);
  const gap = Math.hypot(Math.max(0, q.x0 - p.x1, p.x0 - q.x1), Math.max(0, q.y0 - p.y1, p.y0 - q.y1));
  if (gap > enough) return gap;
  // Only the points near the other loop's box can be the closest.
  const near = (points: CadPoint[], to: typeof p) =>
    points.filter(point => Math.max(to.x0 - point.x, point.x - to.x1, to.y0 - point.y, point.y - to.y1) <= enough + kTolerance);
  let best = Infinity;
  for (const point of near(a, q)) best = Math.min(best, distanceToLoop(point, b));
  for (const point of near(b, p)) best = Math.min(best, distanceToLoop(point, a));
  return Number.isFinite(best) ? best : gap;
}

/**
 * How narrow the part's material gets across the loop itself: twice the radius of the biggest circle that fits inside
 * an outline, as a round bigger than that leaves no face, and the narrowest neck, between two points that face each
 * other square across the material, as the middle of a dumbbell does, where rounds from both sides meet. Around a sharp
 * corner the two sides don't face each other square, and their rounds only meet in a miter.
 */
function selfWidth(loop: CadRimLoop): number {
  const { points } = loop;
  const n = points.length;
  const area = points.reduce((sum, p, i) => sum + p.x * points[(i + 1) % n]!.y - points[(i + 1) % n]!.x * p.y, 0);
  const sign = area > 0 === (loop.material === 'inside') ? 1 : -1;
  let perimeter = 0;
  for (let i = 0; i < n; i++) perimeter += Math.hypot(points[(i + 1) % n]!.x - points[i]!.x, points[(i + 1) % n]!.y - points[i]!.y);
  const step = Math.max(perimeter / kWidthSamples, 1e-6);
  // Points along the loop, each with the way into the material, square to its side.
  const samples: { x: number; y: number; nx: number; ny: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[i]!,
      b = points[(i + 1) % n]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!length) continue;
    const nx = (-(b.y - a.y) / length) * sign,
      ny = ((b.x - a.x) / length) * sign;
    const count = Math.ceil(length / step);
    for (let k = 0; k < count; k++)
      samples.push({ x: a.x + ((b.x - a.x) * (k + 0.5)) / count, y: a.y + ((b.y - a.y) * (k + 0.5)) / count, nx, ny });
  }
  let best = loop.material === 'inside' ? 2 * inradius(points) : Infinity;
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i]!;
    for (let j = i + 1; j < samples.length; j++) {
      const q = samples[j]!;
      const dx = q.x - p.x,
        dy = q.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d >= best || d < 1e-9) continue;
      if ((p.nx * dx + p.ny * dy) / d > kSquare && -(q.nx * dx + q.ny * dy) / d > kSquare) best = d;
    }
  }
  return best;
}

/** How square, as a cosine, two sides must face each other across the material for their rounds to meet head on. */
const kSquare = 0.995;

/** The radius of the biggest circle inside a loop: searched on a grid, then around the best point found, finer. */
function inradius(points: CadPoint[]): number {
  const x0 = Math.min(...points.map(p => p.x)),
    y0 = Math.min(...points.map(p => p.y)),
    x1 = Math.max(...points.map(p => p.x)),
    y1 = Math.max(...points.map(p => p.y));
  let best = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, r: 0 };
  let span = { x: x1 - x0, y: y1 - y0 };
  const grid = 16;
  for (let round = 0; round < 6; round++) {
    const centre = round ? best : { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    for (let i = 0; i <= grid; i++)
      for (let j = 0; j <= grid; j++) {
        const p = { x: centre.x + span.x * (i / grid - 0.5), y: centre.y + span.y * (j / grid - 0.5) };
        if (!pointInPolygon(p, points)) continue;
        const r = distanceToLoop(p, points);
        if (r > best.r) best = { ...p, r };
      }
    span = { x: (span.x * 4) / grid, y: (span.y * 4) / grid };
  }
  return best.r;
}
