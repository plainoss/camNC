import type { CadPart, CadPoint, EvaluatedCadPart } from './types';

/**
 * Recover exact axis intersections only when source constraints prove the directions and the adjustment is at
 * floating-point roundoff scale. This is not geometric simplification: an equally shallow unconstrained slant is
 * retained and refused by occupiedToolBoxes. Cuts and curved boundaries are never changed here.
 */
export function certifiedToolProfile(tool: EvaluatedCadPart, source: CadPart): EvaluatedCadPart {
  const axis = new Map<string, 0 | 1>(); // 0: horizontal, 1: vertical
  let conflict = false;
  const set = (id: string, value: 0 | 1) => {
    if (axis.has(id) && axis.get(id) !== value) conflict = true;
    else axis.set(id, value);
  };
  for (const constraint of source.sketch.constraints) {
    if (constraint.type === 'horizontal') set(constraint.entityId, 0);
    if (constraint.type === 'vertical') set(constraint.entityId, 1);
  }
  for (let changed = true; changed && !conflict; ) {
    const count = axis.size;
    for (const constraint of source.sketch.constraints) {
      if (constraint.type !== 'parallel' && constraint.type !== 'perpendicular') continue;
      const { entityAId: a, entityBId: b } = constraint,
        turn = constraint.type === 'perpendicular' ? 1 : 0;
      if (axis.has(a)) set(b, (axis.get(a)! ^ turn) as 0 | 1);
      if (axis.has(b)) set(a, (axis.get(b)! ^ turn) as 0 | 1);
    }
    changed = count !== axis.size;
  }
  if (conflict || !axis.size) return tool;
  const points = new Map(source.sketch.entities.flatMap(entity => (entity.type === 'point' ? [[entity.id, entity] as const] : [])));
  const mirrored = tool.partId === `${source.id}:mirrored`;
  const sourcePoint = (point: CadPoint): CadPoint => ({ x: mirrored ? -point.x : point.x, y: point.y });
  const canonical = (loop: CadPoint[]) => {
    if (loop.every((point, i) => point.x === loop[(i + 1) % loop.length]!.x || point.y === loop[(i + 1) % loop.length]!.y)) return loop;
    const lineage = tool.loops.find(
      candidate =>
        candidate.points === loop ||
        (candidate.points.length === loop.length && candidate.points.every((point, i) => point.x === loop[i]!.x && point.y === loop[i]!.y))
    );
    if (!lineage) return loop;
    const scale = Math.max(1, ...loop.flatMap(point => [Math.abs(point.x), Math.abs(point.y)]));
    const bound = 64 * Number.EPSILON * scale;
    const near = (a: CadPoint, b: CadPoint) => Math.abs(a.x - b.x) <= bound && Math.abs(a.y - b.y) <= bound;
    const edges = lineage.entityIds.flatMap(id => {
      const entity = source.sketch.entities.find(entity => entity.id === id);
      if (entity?.type !== 'line' || !axis.has(id)) return [];
      const a = points.get(entity.startId),
        b = points.get(entity.endId);
      return a && b ? [{ a: sourcePoint(a), b: sourcePoint(b), axis: axis.get(id)! }] : [];
    });
    const directions = loop.map((point, i) => {
      const next = loop[(i + 1) % loop.length]!;
      const match = edges.filter(edge => (near(edge.a, point) && near(edge.b, next)) || (near(edge.b, point) && near(edge.a, next)));
      return match.length && match.every(edge => edge.axis === match[0]!.axis) ? match[0]!.axis : undefined;
    });
    if (directions.some((value, i) => value === undefined || value === directions[(i + 1) % loop.length])) return loop;
    const result = loop.map((point, i) => {
      const previous = loop[(i + loop.length - 1) % loop.length]!,
        next = loop[(i + 1) % loop.length]!;
      return directions[i] === 0
        ? { x: previous.x / 2 + point.x / 2, y: point.y / 2 + next.y / 2 }
        : { x: point.x / 2 + next.x / 2, y: previous.y / 2 + point.y / 2 };
    });
    return result.every((point, i) => near(point, loop[i]!)) ? result : loop;
  };
  const outline = canonical(tool.outline),
    holes = tool.holes.map(canonical);
  return outline === tool.outline && holes.every((loop, i) => loop === tool.holes[i]) ? tool : { ...tool, outline, holes };
}
