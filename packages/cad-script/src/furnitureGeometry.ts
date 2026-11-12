import {
  activeDesign,
  cadDrawnOnSupports,
  consumedTools,
  effectivePlacement,
  evaluatedPartCopy,
  isCadBody,
  placePoint,
  pointInPolygon,
  rotateVector,
  type CadConstruction,
  type CadPart,
  type CadPartCopy,
  type CadPlacement,
  type CadPoint,
  type EvaluatedCadPart,
} from '@wbcnc/cad';

export type FurniturePoint = [number, number, number];
export interface FurnitureMember {
  role: string;
  identity: string;
  source: CadPart;
  copy?: CadPartCopy;
  shape: EvaluatedCadPart;
  at: CadPlacement;
  low: FurniturePoint;
  high: FurniturePoint;
  local(point: FurniturePoint): FurniturePoint;
  world(point: FurniturePoint): FurniturePoint;
}

export function furnitureMembers(document: CadDocumentLike, parts: readonly EvaluatedCadPart[], plan: CadConstruction) {
  const active = activeDesign(document),
    supports = cadDrawnOnSupports(active),
    consumed = consumedTools(active);
  const result = new Map<string, FurnitureMember>();
  for (const binding of plan.members) {
    const source = active.parts.find(p => p.id === binding.partId);
    const base = parts.find(p => p.partId === binding.partId);
    if (!source || !base?.outline.length || !isCadBody(active, source) || consumed.has(source.id)) continue;
    const copy = binding.copyId === undefined ? undefined : source.copies?.find(c => c.id === binding.copyId);
    if (binding.copyId !== undefined && !copy) continue;
    const at = copy ? copy.placement : effectivePlacement(source, supports);
    if (!at) continue;
    const shape = copy ? evaluatedPartCopy(base, copy) : base;
    const complexity =
      shape.outline.length +
      shape.holes.reduce((n, h) => n + h.length, 0) +
      (shape.cuts ?? []).reduce((n, c) => n + c.outline.length + c.islands.reduce((s, h) => s + h.length, 0), 0);
    // This checker supports bounded recipes; imported dense geometry needs a
    // separate supported construction review rather than an unbounded query.
    if (complexity > 20_000 || (shape.cuts?.length ?? 0) > 64) continue;
    const world = (p: FurniturePoint) => placePoint(at, p);
    const cloud = shape.outline.flatMap(p => [world([p.x, p.y, 0]), world([p.x, p.y, shape.thickness])]);
    const conjugate = [-at.rotation[0], -at.rotation[1], -at.rotation[2], at.rotation[3]];
    result.set(binding.role, {
      role: binding.role,
      identity: JSON.stringify([binding.partId, binding.copyId ?? null]),
      source,
      copy,
      shape,
      at,
      low: [0, 1, 2].map(i => Math.min(...cloud.map(p => p[i]!))) as FurniturePoint,
      high: [0, 1, 2].map(i => Math.max(...cloud.map(p => p[i]!))) as FurniturePoint,
      world,
      local: p => rotateVector(conjugate, p.map((n, i) => n - at.position[i]!) as FurniturePoint),
    });
  }
  return result;
}
type CadDocumentLike = Parameters<typeof activeDesign>[0];

export function furnitureMaterial(shape: EvaluatedCadPart, point: FurniturePoint): boolean {
  const [x, y, z] = point;
  if (z < 0 || z > shape.thickness || !pointInPolygon({ x, y }, shape.outline) || shape.holes.some(h => pointInPolygon({ x, y }, h)))
    return false;
  return !(shape.cuts ?? []).some(c => {
    const lo = c.side === 'top' ? shape.thickness - c.to : c.from;
    const hi = c.side === 'top' ? shape.thickness - c.from : c.to;
    return z >= lo && z <= hi && pointInPolygon({ x, y }, c.outline) && !c.islands.some(h => pointInPolygon({ x, y }, h));
  });
}

export function pointEdgeDistance(p: CadPoint, a: CadPoint, b: CadPoint): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export const loopDistance = (point: CadPoint, loop: readonly CadPoint[]) =>
  loop.reduce((best, a, i) => Math.min(best, pointEdgeDistance(point, a, loop[(i + 1) % loop.length]!)), Infinity);

export function furnitureLoopGap(a: readonly CadPoint[], b: readonly CadPoint[]): number | undefined {
  if (a.length * b.length > 1_000_000) return;
  const cross = (p: CadPoint, q: CadPoint, r: CadPoint) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  let best = Infinity;
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) {
      const p = a[i]!,
        q = a[(i + 1) % a.length]!,
        r = b[j]!,
        s = b[(j + 1) % b.length]!;
      if (cross(p, q, r) * cross(p, q, s) < 0 && cross(r, s, p) * cross(r, s, q) < 0) return 0;
      best = Math.min(best, pointEdgeDistance(p, r, s), pointEdgeDistance(q, r, s), pointEdgeDistance(r, p, q), pointEdgeDistance(s, p, q));
    }
  return best;
}

export function furnitureVoidWall(shape: EvaluatedCadPart, point: CadPoint, z: number): number | undefined {
  const empty = [
    ...shape.holes,
    ...(shape.cuts ?? [])
      .filter(c => {
        const lo = c.side === 'top' ? shape.thickness - c.to : c.from,
          hi = c.side === 'top' ? shape.thickness - c.from : c.to;
        return z > lo && z < hi && !c.islands.some(h => pointInPolygon(point, h));
      })
      .map(c => c.outline),
  ];
  const apertures = empty.filter(h => pointInPolygon(point, h));
  if (!apertures.length) return 0;
  let wall = Infinity;
  for (const aperture of apertures)
    for (const boundary of [shape.outline, ...empty.filter(h => h !== aperture)]) {
      const gap = furnitureLoopGap(aperture, boundary);
      if (gap === undefined) return;
      wall = Math.min(wall, gap);
    }
  return wall;
}

export function furnitureDepthBreaks(shape: EvaluatedCadPart) {
  return [
    ...new Set([
      0,
      shape.thickness,
      ...(shape.cuts ?? []).flatMap(c => (c.side === 'top' ? [shape.thickness - c.to, shape.thickness - c.from] : [c.from, c.to])),
    ]),
  ]
    .filter(v => v >= 0 && v <= shape.thickness)
    .sort((a, b) => a - b);
}

/** Conservative radius contained in one actual empty region, never a nominal sketch diameter. */
export function furnitureVoidRadius(shape: EvaluatedCadPart, point: CadPoint, z: number) {
  const candidates = shape.holes.filter(h => pointInPolygon(point, h)).map(h => loopDistance(point, h));
  for (const c of shape.cuts ?? []) {
    const lo = c.side === 'top' ? shape.thickness - c.to : c.from,
      hi = c.side === 'top' ? shape.thickness - c.from : c.to;
    if (z <= lo || z >= hi || !pointInPolygon(point, c.outline) || c.islands.some(h => pointInPolygon(point, h))) continue;
    candidates.push(Math.min(loopDistance(point, c.outline), ...c.islands.map(h => loopDistance(point, h))));
  }
  return Math.max(0, ...candidates);
}

/** Clip a simple profile against an axis-aligned rectangle. */
export function clipLoopToBox(loop: readonly CadPoint[], low: CadPoint, high: CadPoint): CadPoint[] {
  let points = loop.map(p => ({ ...p }));
  const borders = [
    { axis: 'x', value: low.x, sign: 1 },
    { axis: 'x', value: high.x, sign: -1 },
    { axis: 'y', value: low.y, sign: 1 },
    { axis: 'y', value: high.y, sign: -1 },
  ] as const;
  for (const { axis, value, sign } of borders) {
    const next: CadPoint[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!,
        b = points[(i + 1) % points.length]!;
      const insideA = sign * (a[axis] - value) >= 0,
        insideB = sign * (b[axis] - value) >= 0;
      if (insideA) next.push(a);
      if (insideA !== insideB) {
        const t = (value - a[axis]) / (b[axis] - a[axis]);
        next.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), [axis]: value });
      }
    }
    points = next;
    if (!points.length) return [];
  }
  return points;
}

/** Use local coordinates for the area sum. */
function clippedProfileArea(loop: readonly CadPoint[], low: CadPoint, high: CadPoint) {
  const points = clipLoopToBox(loop, low, high);
  return (
    Math.abs(
      points.reduce((area, a, i) => {
        const b = points[(i + 1) % points.length]!;
        return area + (a.x - low.x) * (b.y - low.y) - (a.y - low.y) * (b.x - low.x);
      }, 0)
    ) / 2
  );
}

/**
 * A box must miss each actual outer-profile prism. Ignoring its holes and pockets
 * is conservative: this never invents access through a removed-material opening.
 */
export function furnitureBoxClear(
  members: Iterable<FurnitureMember>,
  low: FurniturePoint,
  high: FurniturePoint,
  exclude: ReadonlySet<string>
) {
  return ![...members].some(m => {
    if (exclude.has(m.identity) || !low.every((n, i) => Math.min(high[i]!, m.high[i]!) > Math.max(n, m.low[i]!))) return false;
    const corners = Array.from({ length: 8 }, (_, i) =>
      m.local([i & 1 ? high[0] : low[0], i & 2 ? high[1] : low[1], i & 4 ? high[2] : low[2]])
    );
    const lo = [0, 1, 2].map(i => Math.min(...corners.map(p => p[i]!)));
    const hi = [0, 1, 2].map(i => Math.max(...corners.map(p => p[i]!)));
    if (Math.min(hi[2]!, m.shape.thickness) <= Math.max(lo[2]!, 0)) return false;
    return clippedProfileArea(m.shape.outline, { x: lo[0]!, y: lo[1]! }, { x: hi[0]!, y: hi[1]! }) > 0;
  });
}
