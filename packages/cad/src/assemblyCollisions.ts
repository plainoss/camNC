import { pointInPolygon } from './geometry';
import { consumedTools } from './consumedTools';
import { physicalJoinedCopies } from './physicalJoinedCopies';
import { isCadBody } from './extrudeSteps';
import { activeDesign } from './suppression';
import { evaluatedPartCopy } from './copies';
import { cadDrawnOnSupports, effectivePlacement } from './drawnOn';
import { cadCopyName } from './partPatterns';
import { rotateVector } from './placement';
import type { CadDocument, CadPlacement, CadPoint, EvaluatedCadPart } from './types';

type Vec3 = [number, number, number];
export interface CadAssemblyReport {
  /** Each placed part's box in the assembly, in mm: X left to right, Y front to back, Z up. */
  parts: { name: string; at: number[]; size: number[] }[];
  /** Material of two parts in the same place, with the box it fills and its volume in mm³. */
  collisions: { parts: [string, string]; partIds: [string, string]; at: number[]; size: number[]; volume: number }[];
}

const round = (value: number) => Math.round(value * 1000) / 1000;
/** Overlaps smaller than this, in mm³, are rounding: faces that touch. */
const kMinVolume = 1;
const kMaxCells = 400_000;

interface Placed {
  id: string;
  name: string;
  part: EvaluatedCadPart;
  placement: CadPlacement;
  lo: Vec3;
  hi: Vec3;
  /** Coordinates along each assembly axis where its material can change, for axes that are one of the part's own. */
  breaks: (number[] | null)[];
  /** Axes along which material also changes between those coordinates, across a slanted edge or a tilted part. */
  slanted: boolean[];
}

const conjugate = ([x, y, z, w]: readonly number[]) => [-x!, -y!, -z!, w!];
const toLocal = (placement: CadPlacement, point: Vec3): Vec3 =>
  rotateVector(conjugate(placement.rotation), [
    point[0] - placement.position[0],
    point[1] - placement.position[1],
    point[2] - placement.position[2],
  ]);
const toWorld = (placement: CadPlacement, point: Vec3): Vec3 => {
  const turned = rotateVector(placement.rotation, point);
  return [turned[0] + placement.position[0], turned[1] + placement.position[1], turned[2] + placement.position[2]];
};

/** Whether a point in the part's own frame (sketch x and y, z up from its underside) is material. */
function inMaterial(part: EvaluatedCadPart, [x, y, z]: Vec3): boolean {
  const t = part.thickness;
  if (z < 0 || z > t) return false;
  const p = { x, y };
  if (!pointInPolygon(p, part.outline) || part.holes.some(hole => pointInPolygon(p, hole))) return false;
  return !(part.cuts ?? []).some(cut => {
    if (!pointInPolygon(p, cut.outline) || cut.islands.some(island => pointInPolygon(p, island))) return false;
    if (cut.through) return true;
    return cut.side === 'underside' ? z >= cut.from && z <= cut.to : z >= t - cut.to && z <= t - cut.from;
  });
}

function place(part: EvaluatedCadPart, id: string, name: string, placement: CadPlacement): Placed {
  const t = part.thickness;
  const loops = [part.outline, ...part.holes, ...(part.cuts ?? []).flatMap(cut => [cut.outline, ...cut.islands])];
  const own = [
    loops.flatMap(loop => loop.map(p => p.x)),
    loops.flatMap(loop => loop.map(p => p.y)),
    [0, t, ...(part.cuts ?? []).flatMap(cut => (cut.side === 'underside' ? [cut.from, cut.to] : [t - cut.from, t - cut.to]))],
  ];
  const xs = part.outline.map(p => p.x),
    ys = part.outline.map(p => p.y);
  const box = [
    [Math.min(...xs), Math.max(...xs)],
    [Math.min(...ys), Math.max(...ys)],
    [0, t],
  ];
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(i => toWorld(placement, [box[0]![i & 1]!, box[1]![(i >> 1) & 1]!, box[2]![i >> 2]!]));
  const lo = [0, 1, 2].map(a => Math.min(...corners.map(c => c[a]!))) as Vec3,
    hi = [0, 1, 2].map(a => Math.max(...corners.map(c => c[a]!))) as Vec3;
  // An assembly axis that is one of the part's own has its feature edges where material can change.
  const along = [0, 1, 2].map(a => {
    const unit: Vec3 = [0, 0, 0];
    unit[a] = 1;
    const back = rotateVector(conjugate(placement.rotation), unit);
    return { back, k: back.findIndex(c => Math.abs(Math.abs(c) - 1) < 1e-9) };
  });
  const breaks = along.map(({ back, k }, a) => (k < 0 ? null : own[k]!.map(value => placement.position[a]! + back[k]! * value)));
  // A slanted edge, or a curve's facets, changes material between vertices across the sketch, but never up the
  // thickness, so the depths still break exactly while the sketch's axes are also sampled evenly.
  const square = loops.every(loop =>
    loop.every((p, i) => {
      const q = loop[(i + 1) % loop.length]!;
      return Math.abs(p.x - q.x) < 1e-9 || Math.abs(p.y - q.y) < 1e-9;
    })
  );
  return {
    id,
    name,
    part,
    placement,
    lo,
    hi,
    breaks,
    slanted: along.map(({ k }) => k < 0 || (!square && k < 2)),
  };
}

/** Where cell edges fall along one axis of the overlap: at the parts' feature edges, or evenly. */
function cellEdges(lo: number, hi: number, breaks: readonly number[], even: number): number[] {
  const inside = [
    ...breaks.filter(value => value > lo && value < hi),
    ...Array.from({ length: Math.max(0, even - 1) }, (_, i) => lo + ((i + 1) * (hi - lo)) / even),
  ];
  const sorted = [lo, ...inside, hi].sort((a, b) => a - b);
  return sorted.filter((value, i) => i === 0 || value - sorted[i - 1]! > 1e-6);
}

function collide(a: Placed, b: Placed): CadAssemblyReport['collisions'][number] | null {
  const lo = [0, 1, 2].map(i => Math.max(a.lo[i]!, b.lo[i]!)),
    hi = [0, 1, 2].map(i => Math.min(a.hi[i]!, b.hi[i]!));
  if (lo.some((value, i) => hi[i]! - value < 1e-6)) return null;
  let edges = [0, 1, 2].map(i =>
    cellEdges(lo[i]!, hi[i]!, [...(a.breaks[i] ?? []), ...(b.breaks[i] ?? [])], a.slanted[i] || b.slanted[i] ? 24 : 0)
  );
  // Many small features would split the overlap too finely, so it's sampled evenly instead.
  if (edges.reduce((n, e) => n * (e.length - 1), 1) > kMaxCells) edges = [0, 1, 2].map(i => cellEdges(lo[i]!, hi[i]!, [], 60));
  const [ex, ey, ez] = edges as [number[], number[], number[]];
  let volume = 0;
  const min: Vec3 = [Infinity, Infinity, Infinity],
    max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < ex.length - 1; i++)
    for (let j = 0; j < ey.length - 1; j++)
      for (let k = 0; k < ez.length - 1; k++) {
        const from: Vec3 = [ex[i]!, ey[j]!, ez[k]!],
          to: Vec3 = [ex[i + 1]!, ey[j + 1]!, ez[k + 1]!];
        const mid: Vec3 = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
        if (!inMaterial(a.part, toLocal(a.placement, mid)) || !inMaterial(b.part, toLocal(b.placement, mid))) continue;
        volume += (to[0] - from[0]) * (to[1] - from[1]) * (to[2] - from[2]);
        for (let n = 0; n < 3; n++) {
          min[n] = Math.min(min[n]!, from[n]!);
          max[n] = Math.max(max[n]!, to[n]!);
        }
      }
  if (volume < kMinVolume) return null;
  return {
    parts: [a.name, b.name],
    partIds: [a.id, b.id],
    at: min.map(round),
    size: max.map((value, n) => round(value - min[n]!)),
    volume: round(volume),
  };
}

/** Where the placed parts sit, and where any two of them would need the same material. Unplaced parts aren't in it. */
export function assemblyReport(given: CadDocument, parts: readonly EvaluatedCadPart[]): CadAssemblyReport | undefined {
  // Evaluation retains sketch outlines; only active solids and their active copies occupy assembly space.
  const document = physicalJoinedCopies(activeDesign(given));
  // Consumed tool families still evaluate to cut their targets, but occupy no physical assembly space.
  const consumed = consumedTools(document);
  const supports = cadDrawnOnSupports(document);
  const placed = document.parts.flatMap(source => {
    if (!isCadBody(document, source) || consumed.has(source.id)) return [];
    const part = parts.find(candidate => candidate.partId === source.id);
    if (!part?.outline.length) return [];
    // Copies are named as CAM names them: the part's name, then a number.
    const copies = (source.copies ?? []).flatMap((copy, index) =>
      copy.placement ? [place(evaluatedPartCopy(part, copy), source.id, cadCopyName(source, index), copy.placement)] : []
    );
    const at = effectivePlacement(source, supports);
    return [...(at ? [place(part, source.id, source.name, at)] : []), ...copies];
  });
  if (!placed.length) return undefined;
  const collisions: CadAssemblyReport['collisions'] = [];
  placed.forEach((a, i) =>
    placed.slice(i + 1).forEach(b => {
      const found = collide(a, b);
      if (found) collisions.push(found);
    })
  );
  return {
    parts: placed.map(p => ({ name: p.name, at: p.lo.map(round), size: p.hi.map((value, n) => round(value - p.lo[n]!)) })),
    collisions,
  };
}

/** One evaluated piece where the assembly puts it in the end. */
export interface CadAssemblyPiece {
  id: string;
  name: string;
  part: EvaluatedCadPart;
  placement: CadPlacement;
}
export interface CadSweepCollision {
  moving: string;
  fixed: string;
  /** mm short of its final place at which the moving piece first meets the fixed one's material. */
  offset: number;
  /** mm³: at most this much material of the two would have to share space at some point of the travel. */
  volume: number;
}

/** Cross-section cells beyond this are sampled evenly instead of at every feature edge. */
const kMaxSweepCells = 20_000;

/** Cross-section edges closer than this, mm, are one: a curve's facets would otherwise split it needlessly finely. */
const kSweepEdgeMerge = 0.25;

/** Where `p` has material along the sweep axis, through one point of the cross-section, as intervals in mm. */
function materialRuns(p: Placed, axis: number, at: Vec3): [number, number][] {
  const unit: Vec3 = [0, 0, 0];
  unit[axis] = 1;
  const local = toLocal(p.placement, at),
    direction = rotateVector(conjugate(p.placement.rotation), unit);
  const k = direction.findIndex(c => Math.abs(Math.abs(c) - 1) < 1e-9);
  const part = p.part,
    t = part.thickness;
  // Along the line, material can only change where it crosses a contour, or at a depth the part is cut to.
  let stops: number[];
  if (k === 2)
    stops = [0, t, ...(part.cuts ?? []).flatMap(cut => (cut.side === 'underside' ? [cut.from, cut.to] : [t - cut.from, t - cut.to]))];
  else if (k >= 0) {
    const other = 1 - k,
      c = local[other]!;
    const key = (q: CadPoint) => (k === 0 ? [q.x, q.y] : [q.y, q.x]) as [number, number];
    stops = [];
    for (const loop of [part.outline, ...part.holes, ...(part.cuts ?? []).flatMap(cut => [cut.outline, ...cut.islands])])
      loop.forEach((q, i) => {
        const [a0, a1] = key(q),
          [b0, b1] = key(loop[(i + 1) % loop.length]!);
        if ((a1 - c) * (b1 - c) > 0 || a1 === b1) return;
        stops.push(a0 + ((c - a1) * (b0 - a0)) / (b1 - a1));
      });
  } else {
    // A turned part: sample along the line evenly, as world coordinates.
    stops = Array.from({ length: 97 }, (_, i) => p.lo[axis]! + ((p.hi[axis]! - p.lo[axis]!) * i) / 96);
  }
  const sign = k >= 0 ? Math.sign(direction[k]!) : 1;
  // Each stop as a world coordinate along the axis.
  const along = (stop: number) => (k >= 0 ? at[axis]! + (stop - local[k]!) * sign : stop);
  const sorted = [...new Set(stops.map(along))].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i + 1]! - sorted[i]! < 1e-9) continue;
    const point = [...at] as Vec3;
    point[axis] = (sorted[i]! + sorted[i + 1]!) / 2;
    if (!inMaterial(part, toLocal(p.placement, point))) continue;
    const last = runs.at(-1);
    if (last && Math.abs(last[1] - sorted[i]!) < 1e-9) last[1] = sorted[i + 1]!;
    else runs.push([sorted[i]!, sorted[i + 1]!]);
  }
  return runs;
}

/** Cross-section edges between `lo` and `hi`: both pieces' feature edges, near ones merged, or even if too many. */
function sweepEdges(lo: number, hi: number, breaks: readonly number[], slanted: boolean): number[] {
  const sorted = [...breaks.filter(value => value > lo && value < hi)].sort((a, b) => a - b);
  const merged = sorted.filter((value, i) => !i || value - sorted[i - 1]! >= kSweepEdgeMerge);
  return merged.length > 160 ? cellEdges(lo, hi, [], 160) : cellEdges(lo, hi, merged, slanted ? 24 : 0);
}

/**
 * Where `moving`, travelling together in a straight line along `axis` (0 x, 1 y, 2 z) in the `sign` direction, would
 * pass through the material of a `fixed` piece on its way into its final place. It starts clear of every fixed piece
 * and stops at the final placement, where the pieces only touch.
 *
 * The cross-section is split into cells at both pieces' feature edges; through each cell, each piece's material along
 * the axis is a set of runs, and two runs meet at some point of the travel exactly when their offset ranges overlap. So
 * no offset is sampled and nothing between samples can be missed. Slanted or turned features are sampled evenly.
 */
export function assemblySweepCollisions(
  moving: readonly CadAssemblyPiece[],
  fixed: readonly CadAssemblyPiece[],
  axis: 0 | 1 | 2,
  sign: 1 | -1
): CadSweepCollision[] {
  const placedMoving = moving.map(p => place(p.part, p.id, p.name, p.placement));
  const placedFixed = fixed.map(p => place(p.part, p.id, p.name, p.placement));
  if (!placedMoving.length || !placedFixed.length) return [];
  // Far enough back that the whole group starts clear of every fixed piece along the axis.
  const travel =
    sign > 0
      ? Math.max(0, Math.max(...placedMoving.map(p => p.hi[axis])) - Math.min(...placedFixed.map(p => p.lo[axis]))) + 1
      : Math.max(0, Math.max(...placedFixed.map(p => p.hi[axis])) - Math.min(...placedMoving.map(p => p.lo[axis]))) + 1;
  const across = [0, 1, 2].filter(i => i !== axis) as [number, number];
  const found: CadSweepCollision[] = [];
  for (const m of placedMoving)
    for (const f of placedFixed) {
      const lo = across.map(i => Math.max(m.lo[i]!, f.lo[i]!)),
        hi = across.map(i => Math.min(m.hi[i]!, f.hi[i]!));
      // Pieces that don't overlap across the travel never meet.
      if (lo.some((value, k) => hi[k]! - value < 1e-6)) continue;
      let edges = across.map((i, k) =>
        sweepEdges(lo[k]!, hi[k]!, [...(m.breaks[i] ?? []), ...(f.breaks[i] ?? [])], m.slanted[i]! || f.slanted[i]!)
      );
      if ((edges[0]!.length - 1) * (edges[1]!.length - 1) > kMaxSweepCells)
        edges = across.map((_, k) => cellEdges(lo[k]!, hi[k]!, [], 100));
      let volume = 0,
        first = Infinity;
      for (let i = 0; i < edges[0]!.length - 1; i++)
        for (let j = 0; j < edges[1]!.length - 1; j++) {
          const at: Vec3 = [0, 0, 0];
          at[across[0]] = (edges[0]![i]! + edges[0]![i + 1]!) / 2;
          at[across[1]] = (edges[1]![j]! + edges[1]![j + 1]!) / 2;
          const runsF = materialRuns(f, axis, at);
          if (!runsF.length) continue;
          const runsM = materialRuns(m, axis, at);
          const area = (edges[0]![i + 1]! - edges[0]![i]!) * (edges[1]![j + 1]! - edges[1]![j]!);
          for (const [a1, a2] of runsM)
            for (const [b1, b2] of runsF) {
              // The moved run is [a1, a2] - sign·s; the offsets s at which it overlaps [b1, b2], within the travel.
              const start = Math.max(1e-6, sign > 0 ? a1 - b2 : b1 - a2),
                end = Math.min(travel, sign > 0 ? a2 - b1 : b2 - a1);
              if (end - start < 1e-6) continue;
              const overlap = (s: number) => Math.max(0, Math.min(a2 - sign * s, b2) - Math.max(a1 - sign * s, b1));
              const kinks = (sign > 0 ? [a1 - b1, a2 - b2] : [b1 - a1, b2 - a2]).filter(s => s > start && s < end);
              volume += area * Math.max(overlap(start), overlap(end), ...kinks.map(overlap));
              first = Math.min(first, start);
            }
        }
      if (volume >= kMinVolume) found.push({ moving: m.name, fixed: f.name, offset: round(first), volume: round(volume) });
    }
  return found;
}
