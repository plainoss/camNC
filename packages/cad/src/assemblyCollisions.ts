import { pointInPolygon } from './geometry';
import { mirrorEvaluatedPart } from './copies';
import { rotateVector } from './placement';
import type { CadDocument, CadPlacement, EvaluatedCadPart } from './types';

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
export function assemblyReport(document: CadDocument, parts: readonly EvaluatedCadPart[]): CadAssemblyReport | undefined {
  const placed = document.parts.flatMap(source => {
    const part = parts.find(candidate => candidate.partId === source.id);
    if (!part?.outline.length) return [];
    // Copies are named as CAM names them: the part's name, then a number.
    const copies = (source.copies ?? []).flatMap((copy, index) =>
      copy.placement
        ? [place(copy.mirrored ? mirrorEvaluatedPart(part) : part, source.id, `${source.name} ${index + 2}`, copy.placement)]
        : []
    );
    return [...(source.placement ? [place(part, source.id, source.name, source.placement)] : []), ...copies];
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
