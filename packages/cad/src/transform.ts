import { constraintEntityIds, entityPointIds, newCadId, originId } from './document';
import { pointEquivalence } from './pointEquivalence';
import { isOwnedSplineHandle, splineHandleId, splineHandleOwner, withSplineHandleSegments } from './splineHandles';
import { CAD_GEOMETRY_TOLERANCE } from './tolerances';
import type { CadConstraint, CadEntity, CadLineEntity, CadPoint, CadPointEntity, CadSketch } from './types';

export interface CadTransformOptions {
  entityIds: readonly string[];
  translation?: CadPoint;
  /** Counterclockwise degrees. */
  angle?: number;
  scale?: number;
  pivot?: CadPoint;
  copy?: boolean;
}
export type CadTransformResult =
  | {
      ok: true;
      sketch: CadSketch;
      entityIds: string[];
      sourceIds: string[];
      createdEntityIds: string[];
      releasedConstraintIds: string[];
      changed: boolean;
      idMap: Map<string, string>;
    }
  | { ok: false; message: string };

/** Remap structured entity/constraint references without touching labels, expressions or arbitrary strings. */
export function remapCadReferences<T>(value: T, ids: ReadonlyMap<string, string>): T {
  const visit = (input: unknown, key = ''): unknown => {
    if (typeof input === 'string' && (key === 'id' || key.endsWith('Id') || key.endsWith('Ids'))) return ids.get(input) ?? input;
    if (Array.isArray(input)) return input.map(item => visit(item, key));
    if (input && typeof input === 'object' && key === 'idMap')
      return Object.fromEntries(Object.entries(input).map(([logical, id]) => [logical, typeof id === 'string' ? (ids.get(id) ?? id) : id]));
    if (input && typeof input === 'object')
      return Object.fromEntries(Object.entries(input).map(([name, item]) => [name, visit(item, name)]));
    return input;
  };
  return visit(value) as T;
}

/** Similarity transform over one immutable source. Cross-boundary relations detach; internal relations follow the geometry. */
export function transformSketchEntities(sketch: CadSketch, options: CadTransformOptions): CadTransformResult {
  const translation = options.translation ?? { x: 0, y: 0 },
    pivot = options.pivot ?? { x: 0, y: 0 };
  const angle = options.angle ?? 0,
    scale = options.scale ?? 1;
  const fail = (message: string): CadTransformResult => ({ ok: false, message });
  if (![translation.x, translation.y, pivot.x, pivot.y, angle, scale].every(Number.isFinite) || scale <= 1e-8)
    return fail('Enter finite translation, pivot and angle values, and a positive nonzero scale.');
  const entities = new Map(sketch.entities.map(e => [e.id, e]));
  const requested = [...new Set(options.entityIds)];
  if (!requested.length || requested.some(id => !entities.has(id))) return fail('Select sketch geometry to transform.');
  if (requested.includes(originId(sketch))) return fail('The sketch origin cannot be transformed. Select its attached geometry instead.');
  if (
    requested.some(id => {
      const owner = splineHandleOwner(sketch, id);
      return owner && !requested.includes(owner.splineId);
    })
  )
    return fail('Spline tangent handles belong to their curve. Select the complete spline to transform.');
  const sourceIds = new Set(requested.filter(id => !isOwnedSplineHandle(entities.get(id)!)));
  // A complete polygon includes its construction definition circle even when only its boundary is selected.
  for (const c of sketch.constraints)
    if (c.type === 'regularPolygon' && c.edgeIds.every(id => sourceIds.has(id))) sourceIds.add(c.circleId);
  const pointIds = new Set(
    [...sourceIds].flatMap(id => {
      const e = entities.get(id)!;
      return e.type === 'point' ? [id] : entityPointIds(e);
    })
  );
  for (const c of sketch.constraints)
    if (
      c.type === 'circularPattern' &&
      c.instances
        .flatMap(i => i.activeIds)
        .every(
          id =>
            sourceIds.has(id) ||
            pointIds.has(id) ||
            (!!splineHandleOwner(sketch, id) && sourceIds.has(splineHandleOwner(sketch, id)!.splineId))
        )
    ) {
      sourceIds.add(c.centerId);
      pointIds.add(c.centerId);
    }
  if ([...pointIds].some(id => entities.get(id)?.type !== 'point')) return fail('Repair missing source points before transforming.');
  const normalized = ((angle % 360) + 360) % 360;
  const identity =
    Math.min(normalized, 360 - normalized) < 1e-9 && Math.abs(scale - 1) < 1e-12 && Math.hypot(translation.x, translation.y) < 1e-12;
  if (identity && !options.copy)
    return {
      ok: true,
      sketch,
      sourceIds: [...sourceIds],
      entityIds: requested,
      createdEntityIds: [],
      releasedConstraintIds: [],
      changed: false,
      idMap: new Map(),
    };
  const radians = (normalized * Math.PI) / 180,
    cos = Math.cos(radians),
    sin = Math.sin(radians);
  const turn = (point: CadPoint): CadPoint => ({
    x: pivot.x + scale * ((point.x - pivot.x) * cos - (point.y - pivot.y) * sin) + translation.x,
    y: pivot.y + scale * ((point.x - pivot.x) * sin + (point.y - pivot.y) * cos) + translation.y,
  });
  const outsidePointIds = new Set(
    sketch.entities.filter(e => e.type !== 'point' && !isOwnedSplineHandle(e) && !sourceIds.has(e.id)).flatMap(entityPointIds)
  );
  const shared = new Set([...pointIds].filter(id => id === originId(sketch) || outsidePointIds.has(id)));
  const ids = new Map<string, string>();
  for (const id of pointIds) ids.set(id, options.copy || shared.has(id) ? newCadId() : id);
  for (const id of sourceIds) if (!pointIds.has(id)) ids.set(id, options.copy ? newCadId() : id);
  const selectedIds = new Set([...sourceIds, ...pointIds]);
  for (const id of sourceIds) {
    const entity = entities.get(id)!;
    if (entity.type === 'spline' && !entity.closed)
      for (const end of ['start', 'end'] as const) {
        const handle = splineHandleId(id, end);
        selectedIds.add(handle);
        ids.set(handle, splineHandleId(ids.get(id)!, end));
      }
  }
  for (const c of sketch.constraints)
    if (
      (c.type === 'linearPattern' || c.type === 'circularPattern') &&
      constraintEntityIds(c).some(id => sourceIds.has(id)) &&
      !constraintEntityIds(c).every(id => selectedIds.has(id))
    )
      return fail('Select the complete pattern or remove its relation before transforming individual instances.');
  if (options.copy)
    for (const constraint of sketch.constraints)
      if (
        (constraint.type === 'linearPattern' || constraint.type === 'circularPattern') &&
        constraintEntityIds(constraint).every(id => selectedIds.has(id))
      ) {
        const reserved = constraint.instances.flatMap(i => Object.values(i.idMap));
        for (const id of reserved) if (!ids.has(id) && !id.includes(':handle:')) ids.set(id, newCadId());
        for (const id of reserved)
          if (!ids.has(id)) {
            const match = id.match(/^(.*):handle:(start|end)$/);
            ids.set(id, match && ids.has(match[1]!) ? splineHandleId(ids.get(match[1]!)!, match[2] as 'start' | 'end') : newCadId());
          }
      }
  const next = structuredClone(sketch);
  const createdEntityIds: string[] = [],
    releasedConstraintIds: string[] = [];
  const transformed: CadEntity[] = [];
  for (const id of new Set([...pointIds, ...sourceIds])) {
    const source = entities.get(id)!;
    if (isOwnedSplineHandle(source)) continue;
    let entity = remapCadReferences(structuredClone(source), ids);
    if (entity.type === 'point') {
      entity = { ...entity, ...turn(source as CadPointEntity) };
      if (id === originId(sketch)) delete entity.fixed;
      if (requested.includes(id)) entity.standalone = true;
      if (![entity.x, entity.y].every(Number.isFinite)) return fail('The transformed points are outside the supported geometry range.');
    }
    if (entity.type === 'circle' || entity.type === 'arc' || entity.type === 'ellipse') {
      entity.radius *= scale;
      if (!Number.isFinite(entity.radius) || entity.radius <= CAD_GEOMETRY_TOLERANCE)
        return fail('The transformed radius is outside the supported geometry range.');
    }
    if (entity.type === 'arc') {
      entity.startAngle += radians;
      entity.endAngle += radians;
    }
    transformed.push(entity);
    if (entity.id !== id) createdEntityIds.push(entity.id);
  }
  const transformedPoints = new Map(transformed.filter((e): e is CadPointEntity => e.type === 'point').map(e => [e.id, e]));
  for (const entity of transformed)
    if (entity.type === 'line') {
      const a = transformedPoints.get(entity.startId)!,
        b = transformedPoints.get(entity.endId)!;
      if (Math.hypot(a.x - b.x, a.y - b.y) <= CAD_GEOMETRY_TOLERANCE)
        return fail('The transformed line is smaller than the supported geometry tolerance.');
    }
  const replaced = new Set(transformed.filter(e => entities.has(e.id)).map(e => e.id));
  next.entities = next.entities.filter(
    e => !replaced.has(e.id) && !(isOwnedSplineHandle(e) && sourceIds.has(e.owner.splineId) && !options.copy)
  );
  next.entities.push(...transformed);
  const nextEntities = new Map(next.entities.map(e => [e.id, e]));
  const quarter = Math.round(normalized / 90),
    orthogonal = Math.abs(normalized - quarter * 90) < 1e-8;
  let axisId: string | undefined;
  const axis = () => {
    if (axisId) return axisId;
    const a: CadPointEntity = { id: newCadId(), type: 'point', x: 0, y: 0, fixed: true, construction: true };
    const b: CadPointEntity = { id: newCadId(), type: 'point', x: 1, y: 0, fixed: true, construction: true };
    axisId = newCadId();
    next.entities.push(a, b, { id: axisId, type: 'line', startId: a.id, endId: b.id, construction: true });
    createdEntityIds.push(a.id, b.id, axisId);
    return axisId;
  };
  const directionRelation = (c: CadConstraint): CadConstraint => {
    if (!['horizontal', 'vertical', 'horizontalPoints', 'verticalPoints'].includes(c.type)) return c;
    if (orthogonal) {
      if (quarter % 2 === 0) return c;
      const swaps = {
        horizontal: 'vertical',
        vertical: 'horizontal',
        horizontalPoints: 'verticalPoints',
        verticalPoints: 'horizontalPoints',
      } as const;
      return { ...c, type: swaps[c.type as keyof typeof swaps] } as CadConstraint;
    }
    let line: CadLineEntity;
    if ('entityId' in c) line = nextEntities.get(c.entityId) as CadLineEntity;
    else {
      const pair = c as Extract<CadConstraint, { type: 'horizontalPoints' | 'verticalPoints' }>;
      line = { id: newCadId(), type: 'line', startId: pair.pointAId, endId: pair.pointBId, construction: true };
      next.entities.push(line);
      createdEntityIds.push(line.id);
    }
    const a = nextEntities.get(line.startId) as CadPointEntity,
      b = nextEntities.get(line.endId) as CadPointEntity;
    return {
      id: c.id,
      type: 'angle',
      entityAId: axis(),
      entityBId: line.id,
      value: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
      label: 'Orientation',
    };
  };
  const transformConstraint = (source: CadConstraint): CadConstraint | null => {
    let c = remapCadReferences(structuredClone(source), ids);
    if (options.copy || c.id !== source.id) c.id = newCadId();
    if (c.type === 'positionX' || c.type === 'positionY') {
      const before = entities.get(source.type === 'positionX' || source.type === 'positionY' ? source.pointId : '') as CadPointEntity;
      const after = nextEntities.get(c.pointId) as CadPointEntity;
      if (Math.abs(c.type === 'positionX' ? before.x - after.x : before.y - after.y) > CAD_GEOMETRY_TOLERANCE) return null;
    }
    if ((c.type === 'distanceX' || c.type === 'distanceY') && (!orthogonal || quarter % 4 !== 0 || Math.abs(scale - 1) > 1e-12)) {
      const original = source as Extract<CadConstraint, { type: 'distance' | 'distanceX' | 'distanceY' }>;
      const a = entities.get(original.pointAId) as CadPointEntity,
        b = entities.get(original.pointBId) as CadPointEntity;
      if (Math.abs(c.type === 'distanceX' ? a.y - b.y : a.x - b.x) > CAD_GEOMETRY_TOLERANCE) return null;
      c = { ...c, type: 'distance', value: Math.abs(c.value) };
      delete c.expression;
    }
    if (c.type === 'linearPattern') {
      const vector = (p: CadPoint) => ({ x: scale * (p.x * cos - p.y * sin), y: scale * (p.x * sin + p.y * cos) });
      c = { ...c, stepX: vector(c.stepX), stepY: vector(c.stepY) };
    }
    c = directionRelation(c);
    if ('value' in c) {
      delete c.labelPosition;
      delete c.labelPlacement;
      if (!['angle', 'positionX', 'positionY'].includes(c.type) && Math.abs(scale - 1) > 1e-12) {
        c.value *= scale;
        delete c.expression;
      }
    }
    return c;
  };
  next.constraints = [];
  for (const source of sketch.constraints) {
    const refs = constraintEntityIds(source),
      touched = refs.some(id => selectedIds.has(id)),
      internal = refs.every(id => selectedIds.has(id));
    const exclusivelyMoved = refs.some(id => selectedIds.has(id) && !shared.has(id));
    if (options.copy || !touched || !exclusivelyMoved) next.constraints.push(structuredClone(source));
    if (internal) {
      const c = transformConstraint(source);
      if (c) {
        if (!options.copy && !exclusivelyMoved) c.id = newCadId();
        next.constraints.push(c);
      } else if (!options.copy && exclusivelyMoved) releasedConstraintIds.push(source.id);
    } else if (touched && !options.copy && exclusivelyMoved) releasedConstraintIds.push(source.id);
  }
  // Rebuild selected coincidence connectivity even when the old path passed through an unselected alias.
  const equivalent = pointEquivalence(sketch.constraints);
  for (const group of new Set([...pointIds].map(equivalent.canonical))) {
    const members = [...pointIds].filter(id => equivalent.canonical(id) === group).map(id => ids.get(id)!);
    for (let i = 1; i < members.length; i++)
      if (!pointEquivalence(next.constraints).equivalent(members[0]!, members[i]!))
        next.constraints.push({ id: newCadId(), type: 'coincident', pointAId: members[0]!, pointBId: members[i]! });
  }
  return {
    ok: true,
    sketch: withSplineHandleSegments(next),
    entityIds: requested.map(id => ids.get(id)!),
    sourceIds: [...sourceIds],
    createdEntityIds,
    releasedConstraintIds,
    changed: true,
    idMap: ids,
  };
}
