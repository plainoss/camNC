import { constraintEntityIds, entityPointIds, newCadId } from './document';
import { evaluateCurveTangent } from './curves';
import { evaluateCadPart, CAD_GEOMETRY_TOLERANCE } from './geometry';
import { offsetSupport, projectOffsetSupport, intersectOffsetSupports, type OffsetSupport } from './offsetGeometry';
import { pointEquivalence } from './pointEquivalence';
import { sketchPatternOwner } from './pattern';
import type {
  CadArcEntity,
  CadCircleEntity,
  CadEntity,
  CadLineEntity,
  CadPoint,
  CadPointEntity,
  CadSketch,
  CadSlot,
  CadSlotMember,
} from './types';

type Edge = CadLineEntity | CadArcEntity;
type Curve = Edge | CadCircleEntity;
type Step = { curve: Edge; forward: boolean; index: number };
type Node = { key: string; point: CadPoint };
type Spec = {
  key: string;
  type: 'line' | 'arc';
  start: Node;
  end: Node;
  centerId?: string;
  radius?: number;
  startAngle?: number;
  endAngle?: number;
};
const tolerance = CAD_GEOMETRY_TOLERANCE,
  tau = 2 * Math.PI;
const distance = (a: CadPoint, b: CadPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const cross = (a: CadPoint, b: CadPoint) => a.x * b.y - a.y * b.x;
const angular = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
export interface CadSlotOptions {
  entityIds: readonly string[];
  width: number;
  includeConnected?: boolean;
  sharedWidthEntityId?: string;
}
export type CadSlotResult =
  | { ok: true; sketch: CadSketch; slotId: string; widthConstraintId: string; entityIds: string[] }
  | { ok: false; message: string };
const supported = (e: CadEntity): e is Curve => e.type === 'line' || e.type === 'arc' || e.type === 'circle';
export function slotSourceIds(sketch: CadSketch, ids: readonly string[], includeConnected = false): string[] {
  const selected = new Set(ids),
    equivalent = pointEquivalence(sketch.constraints);
  if (includeConnected) {
    let changed = true;
    while (changed) {
      changed = false;
      const vertices = new Set(
        sketch.entities
          .filter(e => selected.has(e.id) && 'startId' in e)
          .flatMap(e => ('startId' in e ? [equivalent.canonical(e.startId), equivalent.canonical(e.endId)] : []))
      );
      for (const e of sketch.entities)
        if (
          supported(e) &&
          e.type !== 'circle' &&
          !selected.has(e.id) &&
          [e.startId, e.endId].some(id => vertices.has(equivalent.canonical(id)))
        ) {
          selected.add(e.id);
          changed = true;
        }
    }
  }
  return [...selected];
}
function components(sketch: CadSketch, curves: Curve[]): (Curve[] | Step[])[] | string {
  const eq = pointEquivalence(sketch.constraints),
    pending = [...curves],
    out: (Curve[] | Step[])[] = [];
  while (pending.length) {
    const first = pending.shift()!;
    if (first.type === 'circle') {
      out.push([first]);
      continue;
    }
    const edges: Edge[] = [first],
      vertices = new Set([eq.canonical(first.startId), eq.canonical(first.endId)]);
    for (let i = 0; i < edges.length; i++)
      for (let j = pending.length - 1; j >= 0; j--) {
        const e = pending[j]!;
        if (e.type !== 'circle' && [e.startId, e.endId].some(id => vertices.has(eq.canonical(id)))) {
          edges.push(e);
          vertices.add(eq.canonical(e.startId));
          vertices.add(eq.canonical(e.endId));
          pending.splice(j, 1);
        }
      }
    const degree = new Map<string, number>();
    for (const e of edges) for (const id of [e.startId, e.endId]) degree.set(eq.canonical(id), (degree.get(eq.canonical(id)) ?? 0) + 1);
    const ends = [...degree].filter(([, n]) => n === 1);
    if ([...degree.values()].some(n => n > 2) || ![0, 2].includes(ends.length))
      return 'Select unbranched paths or closed profiles for a slot.';
    const seed = ends.length ? edges.find(e => [e.startId, e.endId].some(id => degree.get(eq.canonical(id)) === 1))! : edges[0]!;
    let cursor = eq.canonical(degree.get(eq.canonical(seed.startId)) === 1 || !ends.length ? seed.startId : seed.endId);
    const remaining = [...edges],
      steps: Step[] = [];
    while (remaining.length) {
      const index = remaining.findIndex(e => [e.startId, e.endId].some(id => eq.canonical(id) === cursor));
      if (index < 0) return 'The selected slot path is disconnected.';
      const e = remaining.splice(index, 1)[0]!,
        forward = eq.canonical(e.startId) === cursor;
      steps.push({ curve: e, forward, index: curves.indexOf(e) });
      cursor = eq.canonical(forward ? e.endId : e.startId);
    }
    out.push(steps);
  }
  return out;
}
/** Analytic stroke: rounded outside joins, trimmed inside supports and semicircular open ends. */
function buildSlot(
  sketch: CadSketch,
  sourceIds: readonly string[],
  width: number,
  idMap: Record<string, string>,
  sharedWidthEntityId?: string
) {
  if (!Number.isFinite(width) || width <= tolerance * 2) return { ok: false as const, message: 'Enter a positive slot width.' };
  const entities = new Map(sketch.entities.map(e => [e.id, e])),
    points = new Map(sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(e => [e.id, e])),
    curves = sourceIds.map(id => entities.get(id));
  if (!curves.length || curves.some(e => !e || !supported(e)))
    return {
      ok: false as const,
      message:
        'Slot currently supports lines, circular arcs, circles and their unbranched chains. Rational-curve offsets are not supported yet.',
    };
  if (curves.length > 100) return { ok: false as const, message: 'Select at most 100 source curves for one slot group.' };
  const selected = curves as Curve[],
    groups = components(sketch, selected);
  if (typeof groups === 'string') return { ok: false as const, message: groups };
  const first = selected[0]!,
    centerId = first.type === 'circle' ? first.centerId : first.startId,
    half = width / 2;
  if (!points.has(centerId)) return { ok: false as const, message: 'Repair the missing slot source points.' };
  const map = { ...idMap },
    id = (key: string) => map[key] ?? (map[key] = newCadId()),
    specs: Spec[] = [],
    circles: CadCircleEntity[] = [],
    members: CadSlotMember[] = [],
    capKeys: string[] = [];
  const widthEntityId = sharedWidthEntityId ?? id('width');
  if (!sharedWidthEntityId) circles.push({ id: widthEntityId, type: 'circle', centerId, radius: half, construction: true });
  const makeArc = (key: string, start: Node, end: Node, centerId: string, radius: number, sweep?: number): Spec => {
    const center = points.get(centerId)!;
    const a = Math.atan2(start.point.y - center.y, start.point.x - center.x),
      b = Math.atan2(end.point.y - center.y, end.point.x - center.x);
    const spec: Spec = { key, type: 'arc', start, end, centerId, radius, startAngle: a, endAngle: sweep === undefined ? b : a + sweep };
    specs.push(spec);
    return spec;
  };
  for (let g = 0; g < groups.length; g++) {
    const group = groups[g]!;
    if (group[0] && 'type' in group[0]) {
      const source = group[0] as CadCircleEntity;
      for (const side of [1, -1] as const) {
        const radius = source.radius + side * half;
        if (!Number.isFinite(radius) || radius <= tolerance)
          return { ok: false as const, message: 'The slot width collapses an inner circular radius.' };
        const key = `circle:${sourceIds.indexOf(source.id)}:${side}`,
          target = { ...source, id: id(key), radius, construction: false };
        circles.push(target);
        members.push({ kind: 'circle', sourceId: source.id, targetId: target.id, side });
      }
      continue;
    }
    const steps = group as Step[],
      eq = pointEquivalence(sketch.constraints),
      begin = steps[0]!,
      last = steps.at(-1)!,
      closed = eq.equivalent(begin.forward ? begin.curve.startId : begin.curve.endId, last.forward ? last.curve.endId : last.curve.startId);
    const sides = new Map<number, { spec: Spec; normal: Set<'start' | 'end'>; support: OffsetSupport; side: 1 | -1 }[]>();
    for (const flank of [1, -1] as const) {
      const built: { spec: Spec; normal: Set<'start' | 'end'>; support: OffsetSupport; side: 1 | -1 }[] = [];
      for (const step of steps) {
        const source = step.curve,
          side = (flank * (step.forward ? 1 : -1) * (source.type === 'arc' ? -1 : 1)) as 1 | -1,
          support = offsetSupport(source, points, side, half);
        if (typeof support === 'string') return { ok: false as const, message: support };
        const a = points.get(source.startId),
          b = points.get(source.endId);
        if (!a || !b) return { ok: false as const, message: 'Repair missing slot path endpoints.' };
        const key = `edge:${step.index}:${flank}`,
          start = { key: `${key}:start`, point: projectOffsetSupport(support, a) },
          end = { key: `${key}:end`, point: projectOffsetSupport(support, b) };
        const spec: Spec =
          source.type === 'line'
            ? { key, type: 'line', start, end }
            : makeArc(
                key,
                start,
                end,
                source.centerId,
                (support as Extract<OffsetSupport, { kind: 'arc' }>).radius,
                source.endAngle - source.startAngle
              );
        if (source.type === 'line') specs.push(spec);
        built.push({ spec, normal: new Set(['start', 'end']), support, side });
      }
      for (let j = 0; j < steps.length - (closed ? 0 : 1); j++) {
        const next = (j + 1) % steps.length,
          a = steps[j]!,
          b = steps[next]!,
          left = built[j]!,
          right = built[next]!,
          end = a.forward ? 'end' : 'start',
          start = b.forward ? 'start' : 'end',
          jointId = a.forward ? a.curve.endId : a.curve.startId,
          joint = points.get(jointId)!;
        const ta = evaluateCurveTangent(a.curve, points, a.forward ? 1 : 0),
          tb = evaluateCurveTangent(b.curve, points, b.forward ? 0 : 1),
          u = { x: ta.x * (a.forward ? 1 : -1), y: ta.y * (a.forward ? 1 : -1) },
          v = { x: tb.x * (b.forward ? 1 : -1), y: tb.y * (b.forward ? 1 : -1) },
          turn = Math.atan2(cross(u, v), u.x * v.x + u.y * v.y);
        if (Math.abs(Math.abs(turn) - Math.PI) < 1e-8) return { ok: false as const, message: 'A slot path cannot double back at a cusp.' };
        if (Math.abs(turn) < 1e-8) {
          const fixed = (curve: Edge) =>
            entityPointIds(curve).every(id => sketch.entities.some(e => e.type === 'point' && e.fixed && eq.equivalent(e.id, id)));
          const pair = (c: import('./types').CadConstraint) =>
            'entityAId' in c &&
            ((c.entityAId === a.curve.id && c.entityBId === b.curve.id) || (c.entityAId === b.curve.id && c.entityBId === a.curve.id));
          const constrained =
            sketch.constraints.some(c => (c.type === 'tangent' || c.type === 'parallel') && pair(c)) ||
            (a.curve.type === 'line' &&
              b.curve.type === 'line' &&
              (['horizontal', 'vertical'] as const).some(
                type =>
                  sketch.constraints.some(c => c.type === type && c.entityId === a.curve.id) &&
                  sketch.constraints.some(c => c.type === type && c.entityId === b.curve.id)
              ));
          if (!constrained && !(fixed(a.curve) && fixed(b.curve)))
            return {
              ok: false as const,
              message: 'Add a Tangent or Parallel relation at the smooth source join before creating this slot.',
            };
          if (distance(left.spec[end].point, right.spec[start].point) > tolerance * 8)
            return { ok: false as const, message: 'The selected slot path has a disconnected tangent join.' };
          right.spec[start] = left.spec[end];
          if (a.curve.type === 'line') left.normal.delete(end);
          else right.normal.delete(start);
        } else if (turn * flank < 0) {
          let from = left.spec[end],
            to = right.spec[start];
          if (turn < 0) [from, to] = [to, from];
          const cap = makeArc(`join:${g}:${j}:${flank}`, from, to, jointId, half, Math.abs(turn));
          capKeys.push(cap.key);
        } else {
          const intersections = intersectOffsetSupports(left.support, right.support, joint)
            .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
            .sort((a, b) => distance(a, joint) - distance(b, joint));
          if (
            !intersections.length ||
            (intersections[1] &&
              Math.abs(distance(intersections[0]!, joint) - distance(intersections[1], joint)) <= tolerance &&
              distance(intersections[0]!, intersections[1]) > tolerance)
          )
            return { ok: false as const, message: 'The slot width disconnects or makes an inner corner ambiguous.' };
          const node = { key: `inner:${g}:${j}:${flank}`, point: intersections[0]! };
          left.spec[end] = node;
          right.spec[start] = node;
          left.normal.delete(end);
          right.normal.delete(start);
        }
      }
      for (let j = 0; j < built.length; j++) {
        const { spec, support, normal, side } = built[j]!,
          source = steps[j]!.curve;
        if (distance(spec.start.point, spec.end.point) <= tolerance)
          return { ok: false as const, message: 'The slot width consumes an entire path segment.' };
        if (source.type === 'line') {
          const a = points.get(source.startId)!,
            b = points.get(source.endId)!;
          if (
            (spec.end.point.x - spec.start.point.x) * (b.x - a.x) + (spec.end.point.y - spec.start.point.y) * (b.y - a.y) <=
            tolerance * distance(a, b)
          )
            return { ok: false as const, message: 'The slot width reverses an inner path segment.' };
        } else {
          const center = points.get(source.centerId)!;
          spec.startAngle =
            source.startAngle + angular(Math.atan2(spec.start.point.y - center.y, spec.start.point.x - center.x), source.startAngle);
          spec.endAngle = source.endAngle + angular(Math.atan2(spec.end.point.y - center.y, spec.end.point.x - center.x), source.endAngle);
          const oldSweep = (((source.endAngle - source.startAngle) % tau) + tau) % tau,
            newSweep = (((spec.endAngle - spec.startAngle) % tau) + tau) % tau;
          if (newSweep < tolerance || Math.abs(newSweep - oldSweep) > Math.PI)
            return { ok: false as const, message: 'The slot width collapses or reverses an arc interval.' };
        }
        members.push({ kind: source.type, sourceId: source.id, targetId: id(spec.key), side, normalEnds: [...normal] });
      }
      sides.set(flank, built);
    }
    if (!closed) {
      const firstEnd = begin.forward ? 'start' : 'end',
        lastEnd = last.forward ? 'end' : 'start',
        left = sides.get(1)!,
        right = sides.get(-1)!;
      for (const [key, a, b, center] of [
        [`cap:${g}:start`, left[0]!.spec[firstEnd], right[0]!.spec[firstEnd], begin.forward ? begin.curve.startId : begin.curve.endId],
        [`cap:${g}:end`, right.at(-1)!.spec[lastEnd], left.at(-1)!.spec[lastEnd], last.forward ? last.curve.endId : last.curve.startId],
      ] as [string, Node, Node, string][]) {
        const cap = makeArc(key, a, b, center, half, Math.PI);
        capKeys.push(cap.key);
      }
    }
  }
  const nodes = new Map<string, Node>();
  for (const spec of specs) for (const node of [spec.start, spec.end]) nodes.set(node.key, node);
  const generated: CadEntity[] = [
    ...circles,
    ...[...nodes.values()].map(node => ({ id: id(node.key), type: 'point' as const, ...node.point })),
    ...specs.map(spec =>
      spec.type === 'line'
        ? { id: id(spec.key), type: 'line' as const, startId: id(spec.start.key), endId: id(spec.end.key) }
        : {
            id: id(spec.key),
            type: 'arc' as const,
            centerId: spec.centerId!,
            radius: spec.radius!,
            startId: id(spec.start.key),
            endId: id(spec.end.key),
            startAngle: spec.startAngle!,
            endAngle: spec.endAngle!,
          }
    ),
  ];
  const outlines = generated.filter(e => e.type !== 'point' && !e.construction),
    used = new Set(outlines.flatMap(entityPointIds)),
    validation = evaluateCadPart({
      id: 'slot-validation',
      name: 'Slot',
      thickness: 1,
      sketch: {
        id: sketch.id,
        entities: [...points.values(), ...generated.filter(e => e.type === 'point'), ...outlines].filter(
          e => e.type !== 'point' || used.has(e.id)
        ),
        constraints: [],
      },
    });
  if (!validation.part)
    return {
      ok: false as const,
      message: 'The slot width creates intersecting or collapsed boundaries. Reduce the width or repair the source path.',
    };
  return { ok: true as const, generated, idMap: map, members, capIds: capKeys.map(id), widthEntityId };
}
export function slotSketchEntities(sketch: CadSketch, options: CadSlotOptions): CadSlotResult {
  const sourceIds = slotSourceIds(sketch, options.entityIds, options.includeConnected);
  if (sourceIds.some(id => sketchPatternOwner(sketch, id)))
    return { ok: false, message: 'Remove the pattern relation before using its members as a slot path.' };
  if (sourceIds.some(id => sketchSlotOwner(sketch, id)))
    return { ok: false, message: 'This geometry already belongs to a slot. Use another source path or remove its slot relation.' };
  const built = buildSlot(sketch, sourceIds, options.width, {}, options.sharedWidthEntityId);
  if (!built.ok) return built;
  const widthConstraint = options.sharedWidthEntityId
    ? sketch.constraints.find(c => c.type === 'diameter' && c.entityId === options.sharedWidthEntityId)
    : undefined;
  if (widthConstraint && 'value' in widthConstraint && Math.abs(widthConstraint.value - options.width) > tolerance)
    return { ok: false, message: 'Edit the shared slot diameter before adding a path with another width.' };
  if (
    options.sharedWidthEntityId &&
    (!widthConstraint || !sketch.constraints.some(c => c.type === 'slot' && c.widthEntityId === options.sharedWidthEntityId))
  )
    return { ok: false, message: 'The shared slot width is no longer available.' };
  const slot: CadSlot = {
    id: newCadId(),
    type: 'slot',
    sourceIds,
    generatedIds: built.generated.map(e => e.id),
    idMap: built.idMap,
    widthEntityId: built.widthEntityId,
    members: built.members,
    capIds: built.capIds,
    label: 'Slot',
  };
  const dimension = widthConstraint ?? {
    id: newCadId(),
    type: 'diameter' as const,
    entityId: built.widthEntityId,
    value: options.width,
    label: 'Slot width',
  };
  return {
    ok: true,
    sketch: {
      ...sketch,
      entities: [...sketch.entities.map(e => (sourceIds.includes(e.id) ? { ...e, construction: true } : e)), ...built.generated],
      constraints: [...sketch.constraints, slot, ...(widthConstraint ? [] : [dimension])],
    },
    slotId: slot.id,
    widthConstraintId: dimension.id,
    entityIds: built.generated.filter(e => e.type !== 'point' && !e.construction).map(e => e.id),
  };
}
export function sketchSlotOwner(sketch: CadSketch, id: string): CadSlot | undefined {
  return sketch.constraints.find(
    (c): c is CadSlot =>
      c.type === 'slot' &&
      (c.sourceIds.includes(id) || c.generatedIds.includes(id) || c.members.some(m => m.sourceId === id || m.targetId === id))
  );
}
/** Check reservations before rebuilding, so corrupt IDs cannot overwrite a source point. */
export function slotReservationIssue(sketch: CadSketch, slot: CadSlot): string | null {
  if (
    !Array.isArray(slot.sourceIds) ||
    !Array.isArray(slot.generatedIds) ||
    !slot.idMap ||
    typeof slot.idMap !== 'object' ||
    Array.isArray(slot.idMap)
  )
    return 'Invalid slot ownership data.';
  const entities = new Map(sketch.entities.map(e => [e.id, e])),
    sourceGraph = new Set(
      slot.sourceIds.flatMap(id => {
        const e = entities.get(id);
        return e ? [e.id, ...entityPointIds(e)] : [id];
      })
    ),
    values = Object.values(slot.idMap);
  if (
    values.some(id => typeof id !== 'string') ||
    new Set(values).size !== values.length ||
    values.some(id => sourceGraph.has(id)) ||
    slot.generatedIds.some(id => sourceGraph.has(id))
  )
    return 'Slot geometry IDs must be distinct from their source graph.';
  const other = new Set(
    sketch.constraints.flatMap(c =>
      c.type === 'slot' && c.id !== slot.id && c.idMap && typeof c.idMap === 'object' ? Object.values(c.idMap) : []
    )
  );
  if (values.some(id => other.has(id) || (!slot.generatedIds.includes(id) && entities.has(id))))
    return 'Slot geometry reservations collide with other sketch geometry.';
  return null;
}
export function reconcileSlot(sketch: CadSketch, slot: CadSlot): { ok: true; sketch: CadSketch } | { ok: false; message: string } {
  const reservation = slotReservationIssue(sketch, slot);
  if (reservation) return { ok: false, message: reservation };
  const circle = sketch.entities.find(e => e.id === slot.widthEntityId);
  if (circle?.type !== 'circle') return { ok: false, message: 'Repair the missing slot width circle.' };
  const driver = sketch.constraints.find(c => (c.type === 'diameter' || c.type === 'radius') && !c.driven && c.entityId === circle.id),
    width = driver && 'value' in driver ? driver.value * (driver.type === 'radius' ? 2 : 1) : circle.radius * 2;
  const shared = !slot.generatedIds.includes(circle.id),
    built = buildSlot(sketch, slot.sourceIds, width, slot.idMap, shared ? circle.id : undefined);
  if (!built.ok) return built;
  const expected = new Set(slot.generatedIds),
    entities = new Map(sketch.entities.map(e => [e.id, e]));
  if (
    built.generated.length !== expected.size ||
    built.generated.some(
      e =>
        !expected.has(e.id) ||
        entities.get(e.id)?.type !== e.type ||
        JSON.stringify(entityPointIds(entities.get(e.id)!)) !== JSON.stringify(entityPointIds(e))
    )
  )
    return { ok: false, message: 'The source edit changes the slot topology. Remove its relation and recreate the slot.' };
  const next = {
    ...sketch,
    entities: [
      ...sketch.entities.filter(e => !expected.has(e.id)),
      ...built.generated.map(e => {
        const old = entities.get(e.id)!;
        return old.type === 'point' && old.fixed ? old : { ...e, construction: old.construction };
      }),
    ],
  };
  return { ok: true, sketch: next };
}
/** Saved slots may only suppress native cap rules after their entire source/support graph is validated. */
export function slotIssue(sketch: CadSketch, slot: CadSlot): string | null {
  if (
    !Array.isArray(slot.sourceIds) ||
    !slot.sourceIds.length ||
    slot.sourceIds.length > 100 ||
    !Array.isArray(slot.generatedIds) ||
    !Array.isArray(slot.members) ||
    !Array.isArray(slot.capIds) ||
    !slot.idMap ||
    typeof slot.idMap !== 'object' ||
    Array.isArray(slot.idMap)
  )
    return 'Invalid slot ownership data.';
  const reservation = slotReservationIssue(sketch, slot);
  if (reservation) return reservation;
  const values = Object.values(slot.idMap);
  if (values.some(id => typeof id !== 'string') || new Set(values).size !== values.length || Object.keys(slot.idMap).length > 2000)
    return 'Slot geometry IDs must be unique.';
  if (
    [...slot.sourceIds, ...slot.generatedIds, ...slot.capIds].some(id => typeof id !== 'string') ||
    new Set(slot.sourceIds).size !== slot.sourceIds.length ||
    new Set(slot.generatedIds).size !== slot.generatedIds.length
  )
    return 'Slot source and generated geometry must be distinct.';
  if (slot.sourceIds.some(id => slot.generatedIds.includes(id))) return 'A slot cannot own its own source path.';
  const entities = new Map(sketch.entities.map(e => [e.id, e]));
  const circle = entities.get(slot.widthEntityId);
  if (circle?.type !== 'circle') return 'A slot requires a width circle.';
  const built = buildSlot(
    sketch,
    slot.sourceIds,
    circle.radius * 2,
    slot.idMap,
    slot.generatedIds.includes(circle.id) ? undefined : circle.id
  );
  if (!built.ok) return built.message;
  if (
    JSON.stringify(built.members) !== JSON.stringify(slot.members) ||
    JSON.stringify(built.capIds) !== JSON.stringify(slot.capIds) ||
    built.generated.length !== slot.generatedIds.length ||
    built.generated.some(
      e =>
        !slot.generatedIds.includes(e.id) ||
        entities.get(e.id)?.type !== e.type ||
        JSON.stringify(entityPointIds(entities.get(e.id)!)) !== JSON.stringify(entityPointIds(e))
    )
  )
    return 'Slot supports must retain their complete source and endpoint ownership.';
  if (slot.generatedIds.some(id => !values.includes(id)) || values.some(id => !slot.generatedIds.includes(id) && entities.has(id)))
    return 'Inactive slot IDs must not collide with other geometry.';
  return null;
}

export function slotDeletionNotice(before: CadSketch, after: CadSketch): string | null {
  return before.constraints.some(c => c.type === 'slot' && !after.constraints.some(next => next.id === c.id))
    ? 'The slot relation was released. Its surviving outline is independently editable.'
    : null;
}
/** Width helpers belong to the group while any of its slots or external authored relations use them. */
export function removeUnusedSlotWidths(before: CadSketch, after: CadSketch): CadSketch {
  const ids = new Set(
      before.constraints.flatMap(c =>
        c.type === 'slot' && !after.constraints.some(next => next.type === 'slot' && next.widthEntityId === c.widthEntityId)
          ? [c.widthEntityId]
          : []
      )
    ),
    remove = new Set<string>();
  for (const id of ids) {
    const circle = after.entities.find(e => e.id === id);
    if (circle?.type !== 'circle' || !circle.construction) continue;
    if (
      after.constraints.some(
        c => constraintEntityIds(c).includes(id) && !((c.type === 'diameter' || c.type === 'radius') && c.entityId === id)
      )
    )
      continue;
    remove.add(id);
  }
  return remove.size
    ? {
        ...after,
        entities: after.entities.filter(e => !remove.has(e.id)),
        constraints: after.constraints.filter(c => !constraintEntityIds(c).some(id => remove.has(id))),
      }
    : after;
}
