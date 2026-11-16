import { pointInPolygon } from './geometry';
import type { CadDiagnostic, CadFilletRim, CadPart, CadPoint, EvaluatedCadPart, EvaluatedCadRound } from './types';

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
const kWidthSamples = 800;
/** How close, in mm, a picked mesh edge must lie to a loop to be on it: the mesh and the loop are tessellated alike. */
const kPickTolerance = 0.05;

const sides = ['top', 'underside'] as const;

/**
 * The edges along a part's faces a Fillet can round: its outline and through holes, on both sides, and each cut's
 * opening. A cut that runs out past the part's outline, as a rabbet does, has no closed opening, and the outline's edge
 * on that side is cut away in places too, so neither is offered.
 */
export function rimLoops(part: EvaluatedCadPart): CadRimLoop[] {
  const cuts = part.cuts ?? [];
  const open = new Set(
    cuts.filter(cut => cut.outline.some(p => !pointInPolygon(p, part.outline) && distanceToLoop(p, part.outline) > kTolerance))
  );
  const loops: CadRimLoop[] = [];
  for (const side of sides) {
    if (![...open].some(cut => cut.side === side && cut.from === 0))
      loops.push({ id: 'outline', side, at: 0, points: part.outline, material: 'inside', wall: part.thickness });
    for (const loop of part.loops)
      if (loop.kind === 'hole') loops.push({ id: loop.id, side, at: 0, points: loop.points, material: 'outside', wall: part.thickness });
  }
  for (const cut of cuts)
    if (!open.has(cut))
      loops.push({
        id: cut.id,
        side: cut.side,
        at: cut.from,
        points: cut.outline,
        material: 'outside',
        wall: (cut.through ? part.thickness : cut.to) - cut.from,
      });
  return loops;
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
    const others = (loop: CadRimLoop) => loops.filter(other => other !== loop && other.side === loop.side && other.at === loop.at);
    const roundOn = (other: CadRimLoop) =>
      found.includes(other) ? r : rounds.find(round => round.loopId === other.id && round.side === other.side)?.radius;
    const kept = found.filter(loop => {
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
      for (const other of others(loop)) {
        const width = loopDistance(loop.points, other.points);
        const beside = roundOn(other) ?? 0;
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

/** The least distance between two loops that don't cross. */
function loopDistance(a: CadPoint[], b: CadPoint[]): number {
  let best = Infinity;
  for (const p of a) best = Math.min(best, distanceToLoop(p, b));
  for (const p of b) best = Math.min(best, distanceToLoop(p, a));
  return best;
}

/**
 * How narrow the part's material gets across the loop itself, as between the two long sides of a thin strip: the least
 * distance, through the material, between two points of the loop far enough apart along it not to be neighbours. Rounds
 * of radius r from both meet when they're 2r apart; two points that close along a smooth bend are further apart along
 * the loop than π·r, and around a corner they're less, so only those further along than that can meet. Material inside
 * a loop is never wider than its perimeter over π, a circle's diameter.
 */
function selfWidth(loop: CadRimLoop): number {
  const samples: { p: CadPoint; s: number }[] = [];
  const n = loop.points.length;
  let perimeter = 0;
  for (let i = 0; i < n; i++) {
    const a = loop.points[i]!,
      b = loop.points[(i + 1) % n]!;
    perimeter += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const step = Math.max(perimeter / kWidthSamples, 1e-6);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const a = loop.points[i]!,
      b = loop.points[(i + 1) % n]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const count = Math.max(1, Math.ceil(length / step));
    for (let k = 0; k < count; k++)
      samples.push({ p: { x: a.x + ((b.x - a.x) * k) / count, y: a.y + ((b.y - a.y) * k) / count }, s: s + (length * k) / count });
    s += length;
  }
  let best = loop.material === 'inside' ? perimeter / Math.PI : Infinity;
  for (let i = 0; i < samples.length; i++)
    for (let j = i + 1; j < samples.length; j++) {
      const p = samples[i]!.p,
        q = samples[j]!.p;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d >= best) continue;
      const apart = samples[j]!.s - samples[i]!.s;
      if (Math.min(apart, perimeter - apart) < ((Math.PI * d) / 2) * (1 - 1e-9)) continue;
      // Only across the material: across an empty notch, the rounds on its two sides don't meet.
      if (pointInPolygon({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, loop.points) === (loop.material === 'inside')) best = d;
    }
  return best;
}
