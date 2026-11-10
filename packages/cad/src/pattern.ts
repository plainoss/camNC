import { patternAngle, patternPosition } from './patternPlacement';
import { materializePatternJoins, removeUnusedPatternCenters } from './patternTopology';
import { constraintEntityIds, entityPointIds, newCadId, originId } from './document';
import { CAD_GEOMETRY_TOLERANCE } from './tolerances';
import { isOwnedSplineHandle, splineHandleId, splineHandleOwner, withSplineHandleSegments } from './splineHandles';
import { remapCadReferences, transformSketchEntities } from './transform';
import type {
  CadEntity,
  CadLinearPatternExpressions,
  CadSketchPattern,
  CadPatternInstance,
  CadPoint,
  CadPointEntity,
  CadSketch,
} from './types';

const cellKey = (x: number, y: number) => `${x}:${y}`;
export function patternInstanceOffset(pattern: CadSketchPattern, instance: Pick<CadPatternInstance, 'x' | 'y'>): CadPoint {
  if (pattern.type === 'circularPattern') return { x: 0, y: 0 };
  return {
    x: (instance.x - pattern.masterX) * pattern.stepX.x + (instance.y - pattern.masterY) * pattern.stepY.x,
    y: (instance.x - pattern.masterX) * pattern.stepX.y + (instance.y - pattern.masterY) * pattern.stepY.y,
  };
}
export function patternMaster(pattern: CadSketchPattern): CadPatternInstance | undefined {
  return pattern.instances.find(i => i.x === pattern.masterX && i.y === pattern.masterY);
}
export const patternExcluded = (pattern: CadSketchPattern, seedKey: string, x: number, y: number) =>
  pattern.exclusions.some(e => e.seedKey === seedKey && e.x === x && e.y === y);
export const patternSourceIds = (pattern: CadSketchPattern) => {
  const master = patternMaster(pattern);
  return master ? pattern.seedKeys.map(key => master.idMap[key]!) : [];
};
export interface CadLinearPatternOptions {
  entityIds?: readonly string[];
  countX: number;
  countY?: number;
  stepX: CadPoint;
  stepY?: CadPoint;
  /** Counts and spacings as typed, kept when they use design variables. Editing a pattern replaces them. */
  expressions?: CadLinearPatternExpressions;
  patternId?: string;
  previewLimit?: number;
}
export type CadPatternResult =
  | { ok: true; sketch: CadSketch; patternId: string; entityIds: string[]; releasedConstraintIds: string[] }
  | { ok: false; message: string };
function limits(pattern: CadSketchPattern): string | null {
  if (
    ![pattern.countX, pattern.countY].every(n => Number.isInteger(n) && n >= 1 && n <= 200) ||
    pattern.countX * pattern.countY < 2 ||
    pattern.countX * pattern.countY > 200
  )
    return 'Use two to 200 total pattern instances, including the original.';
  if (pattern.type === 'circularPattern') {
    if (
      pattern.countY !== 1 ||
      !Number.isFinite(pattern.angle) ||
      typeof pattern.closed !== 'boolean' ||
      Math.abs(pattern.angle) < 1e-6 ||
      Math.abs(pattern.angle) > 360 ||
      (pattern.closed && Math.abs(Math.abs(pattern.angle) - 360) > 1e-8) ||
      (!pattern.closed && Math.abs(pattern.angle) >= 360)
    )
      return 'Use a nonzero sweep below 360 degrees for an open pattern, or 360 degrees for a closed pattern.';
    return null;
  }
  if (![pattern.stepX.x, pattern.stepX.y, pattern.stepY.x, pattern.stepY.y].every(Number.isFinite))
    return 'Enter finite pattern spacing and direction values.';
  const offsets: CadPoint[] = [];
  for (let y = 0; y < pattern.countY; y++)
    for (let x = 0; x < pattern.countX; x++) {
      const offset = patternInstanceOffset(pattern, { x, y });
      if (![offset.x, offset.y].every(Number.isFinite)) return 'The pattern spacing is outside the supported geometry range.';
      if (offsets.some(p => Math.hypot(p.x - offset.x, p.y - offset.y) <= CAD_GEOMETRY_TOLERANCE))
        return 'Choose spacing and directions that keep every pattern instance distinct.';
      offsets.push(offset);
    }
  return null;
}

/** Synchronize topology and scalar metadata before native registration; reserved IDs never resurrect excluded seeds. */
export function reconcileLinearPattern(sketch: CadSketch, pattern: CadSketchPattern, previewLimit = Infinity): CadPatternResult {
  const reservation = linearPatternReservationIssue(sketch, pattern);
  if (reservation) return { ok: false, message: reservation };
  const problem = limits(pattern);
  if (problem) return { ok: false, message: problem };
  const next = structuredClone(sketch),
    group = structuredClone(pattern),
    entities = new Map(next.entities.map(e => [e.id, e]));
  const master = patternMaster(group);
  if (!master)
    return { ok: false, message: 'The pattern has lost its master instance. Delete its pattern relation to keep the remaining geometry.' };
  if (group.type === 'circularPattern' && entities.get(group.centerId)?.type !== 'point')
    return { ok: false, message: 'The circular pattern needs its center point.' };
  const sourceIds = patternSourceIds(group),
    sources = sourceIds.map(id => entities.get(id));
  if (sources.some(e => !e || isOwnedSplineHandle(e)))
    return { ok: false, message: 'Repair the pattern source before editing its instances.' };
  const sourcePoints = new Set((sources as CadEntity[]).flatMap(e => (e.type === 'point' ? [e.id] : entityPointIds(e))));
  if (sourcePoints.size * (group.countX * group.countY - 1) > 1000)
    return { ok: false, message: 'This pattern would exceed 1,000 copied sketch points. Reduce its count or source selection.' };
  const reverse = new Map(Object.entries(master.idMap).map(([key, id]) => [id, key]));
  const sourceTopologyChanged = [...sourcePoints].some(id => !reverse.has(id));
  for (const id of sourcePoints)
    if (!reverse.has(id)) {
      master.idMap[id] = id;
      reverse.set(id, id);
    }
  const graphKeys = new Set([...group.seedKeys, ...[...sourcePoints].map(id => reverse.get(id)!)]);
  for (const seed of sources as CadEntity[])
    if (seed.type === 'spline' && !seed.closed) {
      const key = reverse.get(seed.id)!;
      for (const end of ['start', 'end'] as const) {
        const handleKey = `${key}:handle:${end}`;
        master.idMap[handleKey] = splineHandleId(seed.id, end);
        graphKeys.add(handleKey);
      }
    }
  if (!sourceTopologyChanged)
    for (const instance of group.instances)
      if (instance !== master)
        for (const key of group.seedKeys) {
          if (!instance.activeIds.includes(instance.idMap[key]!) || patternExcluded(group, key, instance.x, instance.y)) continue;
          const source = entities.get(master.idMap[key]!)!,
            target = entities.get(instance.idMap[key]!);
          const mapped = remapCadReferences(
            source,
            new Map([...reverse].map(([id, logical]) => [id, instance.idMap[logical]!]))
          ) as CadEntity;
          if (
            !target ||
            source.type !== target.type ||
            JSON.stringify(source.type === 'ellipse' ? [...entityPointIds(mapped)].sort() : entityPointIds(mapped)) !==
              JSON.stringify(source.type === 'ellipse' ? [...entityPointIds(target)].sort() : entityPointIds(target))
          )
            return { ok: false, message: 'Edit the pattern source or remove its pattern relation before changing copied topology.' };
        }
  for (const instance of group.instances)
    for (const key of Object.keys(instance.idMap)) if (!graphKeys.has(key)) delete instance.idMap[key];
  // Existing replicas are replaced from their immutable source; preserve external references on still-active IDs.
  const owned = new Set(group.instances.filter(i => i !== master).flatMap(i => i.activeIds));
  const outsideUses = new Set(next.entities.filter(e => !owned.has(e.id)).flatMap(entityPointIds));
  outsideUses.add(originId(sketch));
  for (const entity of next.entities) if (entity.type === 'point' && entity.faceEdge) outsideUses.add(entity.id);
  next.entities = next.entities.filter(e => !owned.has(e.id));
  const usedCells = new Set<string>(),
    active = new Set<string>(),
    seedUnits = new Set(group.seedKeys),
    output: CadEntity[] = [];
  let shown = 0;
  for (let y = 0; y < group.countY; y++)
    for (let x = 0; x < group.countX; x++) {
      const key = cellKey(x, y);
      usedCells.add(key);
      let instance = group.instances.find(i => i.x === x && i.y === y);
      if (!instance) {
        instance = { x, y, idMap: {}, activeIds: [] };
        group.instances.push(instance);
      }
      instance.activeIds = [];
      const isMaster = instance === master;
      if (!isMaster && shown++ >= previewLimit) continue;
      const liveSeeds = group.seedKeys.filter(seed => !patternExcluded(group, seed, x, y));
      const pointIds = new Set(
        liveSeeds.flatMap(seed => {
          const source = entities.get(master.idMap[seed]!)!;
          return source.type === 'point' ? [source.id] : entityPointIds(source);
        })
      );
      if (isMaster) {
        instance.activeIds = [...new Set([...liveSeeds.map(seed => master.idMap[seed]!), ...pointIds])];
        for (const seed of liveSeeds) {
          const source = entities.get(master.idMap[seed]!);
          if (source?.type === 'spline' && !source.closed)
            instance.activeIds.push(splineHandleId(source.id, 'start'), splineHandleId(source.id, 'end'));
        }
        instance.activeIds.forEach(id => active.add(id));
        continue;
      }

      for (const sourceId of pointIds) {
        const logical = reverse.get(sourceId)!;
        instance.idMap[logical] ??= newCadId();
      }
      for (const seed of liveSeeds) instance.idMap[seed] ??= newCadId();
      const ids = new Map([...sourcePoints].filter(id => pointIds.has(id)).map(id => [id, instance!.idMap[reverse.get(id)!]!]));
      for (const seed of liveSeeds) ids.set(master.idMap[seed]!, instance.idMap[seed]!);
      for (const sourceId of pointIds) {
        const source = entities.get(sourceId);
        if (source?.type !== 'point') return { ok: false, message: 'Repair missing pattern source points.' };
        const id = ids.get(sourceId)!,
          previous = entities.get(id),
          point: CadPointEntity = {
            ...source,
            id,
            x: previous?.type === 'point' && previous.fixed ? previous.x : patternPosition(group, instance, source, entities).x,
            y: previous?.type === 'point' && previous.fixed ? previous.y : patternPosition(group, instance, source, entities).y,
            fixed: previous?.type === 'point' ? previous.fixed : undefined,
            standalone: seedUnits.has(reverse.get(sourceId)!),
          };
        if (![point.x, point.y].every(Number.isFinite))
          return { ok: false, message: 'The pattern geometry is outside the supported range.' };
        output.push(point);
        instance.activeIds.push(id);
        active.add(id);
      }
      for (const seed of liveSeeds) {
        const source = entities.get(master.idMap[seed]!)!;
        if (source.type === 'point') continue;
        const copy = remapCadReferences(structuredClone(source), ids);
        if (copy.type === 'arc') {
          const angle = patternAngle(group, instance);
          copy.startAngle += angle;
          copy.endAngle += angle;
        }
        if (instance.constructionOverrides && seed in instance.constructionOverrides)
          copy.construction = instance.constructionOverrides[seed];
        output.push(copy);
        instance.activeIds.push(copy.id);
        active.add(copy.id);
        if (copy.type === 'spline' && !copy.closed)
          for (const end of ['start', 'end'] as const) {
            const handle = splineHandleId(copy.id, end);
            instance.idMap[`${seed}:handle:${end}`] = handle;
            instance.activeIds.push(handle);
            active.add(handle);
          }
      }
    }
  for (const instance of group.instances) if (!usedCells.has(cellKey(instance.x, instance.y))) instance.activeIds = [];
  next.entities.push(...output);
  const removed = new Set([...owned].filter(id => !active.has(id)));
  for (const id of [...removed])
    if (outsideUses.has(id)) {
      const point = entities.get(id);
      if (point?.type === 'point') {
        next.entities.push(point);
        removed.delete(id);
        // A detached outside endpoint must not jump back into a future regrown cell.
        for (const instance of group.instances)
          for (const [key, value] of Object.entries(instance.idMap))
            if (value === id && !instance.activeIds.includes(id)) instance.idMap[key] = newCadId();
      }
    }
  const releasedConstraintIds: string[] = [];
  next.constraints = next.constraints.flatMap(c => {
    if (c.id === group.id) return [];
    if (constraintEntityIds(c).some(id => removed.has(id))) {
      releasedConstraintIds.push(c.id);
      return [];
    }
    return [c];
  });
  next.constraints.push(group);
  return {
    ok: true,
    sketch: withSplineHandleSegments(next),
    patternId: group.id,
    entityIds: group.instances.flatMap(i =>
      group.seedKeys.filter(key => !patternExcluded(group, key, i.x, i.y) && i.activeIds.includes(i.idMap[key]!)).map(key => i.idMap[key]!)
    ),
    releasedConstraintIds,
  };
}
export function linearPatternSketchEntities(sketch: CadSketch, options: CadLinearPatternOptions): CadPatternResult {
  const existing = options.patternId ? sketch.constraints.find(c => c.id === options.patternId) : undefined;
  if (existing && existing.type !== 'linearPattern') return { ok: false, message: 'Select a linear pattern to edit.' };
  let group: CadSketchPattern;
  if (existing?.type === 'linearPattern') {
    let base = structuredClone(existing);
    if (base.masterX >= options.countX || base.masterY >= (options.countY ?? 1)) {
      const entities = new Set(sketch.entities.map(e => e.id));
      const candidate = base.instances.find(
        i =>
          i.x < options.countX &&
          i.y < (options.countY ?? 1) &&
          base.seedKeys.every(key => !patternExcluded(base, key, i.x, i.y) && entities.has(i.idMap[key]!))
      );
      if (!candidate) return { ok: false, message: 'Keep a complete surviving instance inside the requested pattern range.' };
      const rebased = rebaseLinearPattern(sketch, sketch, base, candidate.x, candidate.y);
      if (!rebased.ok) return rebased;
      sketch = rebased.sketch;
      if (rebased.pattern.type !== 'linearPattern') return { ok: false, message: 'Select a linear pattern.' };
      base = rebased.pattern;
    }
    const { expressions: _typed, ...kept } = base;
    group = {
      ...kept,
      countX: options.countX,
      countY: options.countY ?? 1,
      stepX: options.stepX,
      stepY: options.stepY ?? { x: 0, y: 40 },
      ...(options.expressions && { expressions: options.expressions }),
    };
  } else {
    const entities = new Map(sketch.entities.map(e => [e.id, e])),
      ids = new Set(options.entityIds ?? []);
    if (!ids.size || [...ids].some(id => !entities.has(id) || id === originId(sketch) || entities.get(id)!.faceEdge))
      return { ok: false, message: 'Select sketch geometry to pattern.' };
    if (
      [...ids].some(id => {
        const owner = splineHandleOwner(sketch, id);
        return owner && !ids.has(owner.splineId);
      })
    )
      return { ok: false, message: 'Select the complete spline rather than its tangent handles.' };
    if ([...ids].some(id => sketchPatternOwner(sketch, id, true)))
      return { ok: false, message: 'Use the original source geometry rather than a derived pattern instance as a new pattern source.' };
    for (const id of ids) if (isOwnedSplineHandle(entities.get(id)!)) ids.delete(id);
    for (const c of sketch.constraints) if (c.type === 'regularPolygon' && c.edgeIds.every(id => ids.has(id))) ids.add(c.circleId);
    const points = new Set(
      [...ids].flatMap(id => {
        const e = entities.get(id)!;
        return e.type === 'point' ? [id] : entityPointIds(e);
      })
    );
    const idMap = Object.fromEntries([...new Set([...ids, ...points])].map(id => [id, id]));
    group = {
      id: options.patternId ?? newCadId(),
      type: 'linearPattern',
      seedKeys: [...ids],
      masterX: 0,
      masterY: 0,
      countX: options.countX,
      countY: options.countY ?? 1,
      stepX: options.stepX,
      stepY: options.stepY ?? { x: 0, y: 40 },
      ...(options.expressions && { expressions: options.expressions }),
      instances: [{ x: 0, y: 0, idMap, activeIds: [] }],
      exclusions: [],
      label: 'Linear pattern',
    };
  }
  return reconcileLinearPattern(sketch, group, options.previewLimit);
}
/** Validate both saved reservations and complete live coverage before skipping copied native implicit equations. */
export function linearPatternIssue(sketch: CadSketch, pattern: CadSketchPattern): string | null {
  if (
    !Array.isArray(pattern.seedKeys) ||
    !pattern.seedKeys.length ||
    !Array.isArray(pattern.instances) ||
    !Array.isArray(pattern.exclusions) ||
    (pattern.type === 'linearPattern' && (!pattern.stepX || !pattern.stepY))
  )
    return 'A linear pattern needs a source graph, cell maps and spacing.';
  if (pattern.seedKeys.some(k => typeof k !== 'string') || new Set(pattern.seedKeys).size !== pattern.seedKeys.length)
    return 'Pattern source keys must be distinct strings.';
  const reservation = linearPatternReservationIssue(sketch, pattern);
  if (reservation) return reservation;
  const setting = limits(pattern);
  if (setting) return setting;
  if (
    ![pattern.masterX, pattern.masterY].every(n => Number.isInteger(n) && n >= 0) ||
    pattern.masterX >= pattern.countX ||
    pattern.masterY >= pattern.countY
  )
    return 'The master must lie inside the active pattern range.';
  const cells = new Set<string>(),
    allTargets = new Set<string>();
  for (const i of pattern.instances) {
    if (
      !i ||
      ![i.x, i.y].every(n => Number.isInteger(n) && n >= 0 && n < 200) ||
      !i.idMap ||
      typeof i.idMap !== 'object' ||
      Array.isArray(i.idMap) ||
      !Array.isArray(i.activeIds) ||
      Object.values(i.idMap).some(id => typeof id !== 'string') ||
      i.activeIds.some(id => typeof id !== 'string') ||
      new Set(i.activeIds).size !== i.activeIds.length
    )
      return 'A pattern cell needs valid coordinates and a point/entity map.';
    if (
      i.constructionOverrides &&
      (typeof i.constructionOverrides !== 'object' ||
        Array.isArray(i.constructionOverrides) ||
        Object.entries(i.constructionOverrides).some(([key, value]) => !pattern.seedKeys.includes(key) || typeof value !== 'boolean'))
    )
      return 'Pattern construction overrides need a source key and boolean state.';
    const key = cellKey(i.x, i.y);
    if (cells.has(key)) return 'Pattern cell keys must be unique.';
    cells.add(key);
    for (const id of i.activeIds) {
      if (allTargets.has(id)) return 'Pattern cells must own distinct geometry.';
      allTargets.add(id);
    }
  }
  const exclusions = new Set<string>();
  for (const e of pattern.exclusions) {
    if (!e || !pattern.seedKeys.includes(e.seedKey) || ![e.x, e.y].every(n => Number.isInteger(n) && n >= 0 && n < 200))
      return 'Pattern exclusions need a source key and cell coordinates.';
    const key = `${e.seedKey}:${e.x}:${e.y}`;
    if (exclusions.has(key)) return 'Pattern exclusions must be unique.';
    exclusions.add(key);
  }
  const master = patternMaster(pattern);
  if (!master) return 'The pattern master is missing.';
  const entities = new Map(sketch.entities.map(e => [e.id, e]));
  if (pattern.type === 'circularPattern' && entities.get(pattern.centerId)?.type !== 'point')
    return 'The circular pattern needs a live center point.';
  const reverse = new Map(Object.entries(master.idMap).map(([key, id]) => [id, key]));
  const sourceIds = patternSourceIds(pattern);
  if (new Set(sourceIds).size !== sourceIds.length || sourceIds.some(id => !entities.has(id) || isOwnedSplineHandle(entities.get(id)!)))
    return 'A pattern master must contain every distinct source entity.';
  if (pattern.seedKeys.some(key => patternExcluded(pattern, key, master.x, master.y)))
    return 'A pattern master must be a complete surviving instance.';
  for (let y = 0; y < pattern.countY; y++)
    for (let x = 0; x < pattern.countX; x++) {
      const instance = pattern.instances.find(i => i.x === x && i.y === y);
      if (!instance) return 'The pattern has an incomplete instance map.';
      const expected = new Set<string>();
      for (const key of pattern.seedKeys) {
        if (patternExcluded(pattern, key, x, y)) continue;
        const source = entities.get(master.idMap[key]!)!,
          copy = entities.get(instance.idMap[key]!);
        if (!copy || copy.type !== source.type) return 'Every live pattern entity must match its source type.';
        expected.add(copy.id);
        const ids = source.type === 'point' ? [source.id] : entityPointIds(source);
        for (const id of ids) {
          const logical = reverse.get(id),
            target = logical && instance.idMap[logical];
          if (!target || entities.get(target)?.type !== 'point') return 'A pattern copy is missing a source point link.';
          expected.add(target);
        }
        const remapped = remapCadReferences(
          source,
          new Map([...reverse].map(([id, logical]) => [id, instance.idMap[logical]!]))
        ) as CadEntity;
        if (source.type !== 'point' && JSON.stringify(entityPointIds(remapped)) !== JSON.stringify(entityPointIds(copy)))
          return 'Pattern topology must follow its master.';
        if (source.type === 'spline') {
          if (
            copy.type !== 'spline' ||
            source.degree !== copy.degree ||
            source.closed !== copy.closed ||
            JSON.stringify(source.knots) !== JSON.stringify(copy.knots) ||
            JSON.stringify(source.weights) !== JSON.stringify(copy.weights) ||
            JSON.stringify(source.fitParameters) !== JSON.stringify(copy.fitParameters)
          )
            return 'Copied spline bases must follow their source.';
          if (!source.closed) {
            expected.add(splineHandleId(copy.id, 'start'));
            expected.add(splineHandleId(copy.id, 'end'));
          }
        }
        if (source.type === 'conic' && (copy.type !== 'conic' || source.rho !== copy.rho))
          return 'Copied conic weights must follow their source.';
      }
      if (expected.size !== instance.activeIds.length || instance.activeIds.some(id => !expected.has(id) || !entities.has(id)))
        return 'A pattern cell must own exactly its live geometry and points.';
    }
  for (const i of pattern.instances)
    if ((i.x >= pattern.countX || i.y >= pattern.countY) && i.activeIds.length) return 'Inactive pattern cells cannot own live geometry.';
  return null;
}

export function sketchPatternOwner(sketch: CadSketch, entityId: string, replicasOnly = false): CadSketchPattern | undefined {
  return sketch.constraints.find(
    (c): c is CadSketchPattern =>
      (c.type === 'linearPattern' || c.type === 'circularPattern') &&
      c.instances.some(i => (!replicasOnly || i !== patternMaster(c)) && i.activeIds.includes(entityId))
  );
}
/** Reservations are ownership promises even while a cell is excluded or outside the current count. */
export function linearPatternReservationIssue(sketch: CadSketch, pattern: CadSketchPattern): string | null {
  if (!Array.isArray(pattern.instances) || !Array.isArray(pattern.seedKeys)) return 'Invalid pattern reservation data.';
  const master = patternMaster(pattern);
  if (!master || !master.idMap || typeof master.idMap !== 'object') return 'The pattern master map is missing.';
  const entities = new Map(sketch.entities.map(e => [e.id, e])),
    masterSources = pattern.seedKeys.map(key => entities.get(master.idMap[key]!)).filter((e): e is CadEntity => !!e);
  const masterGraph = new Set(
    masterSources.flatMap(e => [
      e.id,
      ...entityPointIds(e),
      ...(e.type === 'spline' && !e.closed ? [splineHandleId(e.id, 'start'), splineHandleId(e.id, 'end')] : []),
    ])
  );
  const reserved = new Set<string>();
  const otherReserved = new Set(
    sketch.constraints.flatMap(c =>
      (c.type === 'linearPattern' || c.type === 'circularPattern') && c.id !== pattern.id && Array.isArray(c.instances)
        ? c.instances.flatMap(i => (i && i.idMap ? Object.values(i.idMap) : []))
        : []
    )
  );
  for (const instance of pattern.instances) {
    if (
      !instance ||
      !instance.idMap ||
      typeof instance.idMap !== 'object' ||
      Array.isArray(instance.idMap) ||
      !Array.isArray(instance.activeIds)
    )
      return 'Invalid pattern instance map.';
    for (const id of Object.values(instance.idMap)) {
      if (typeof id !== 'string' || reserved.has(id)) return 'Pattern source and reserved copy IDs must be distinct.';
      reserved.add(id);
      const live = instance.activeIds.includes(id) || (instance === master && masterGraph.has(id));
      if (!live && (entities.has(id) || otherReserved.has(id)))
        return 'An inactive pattern reservation collides with other sketch geometry.';
    }
  }
  return null;
}
/** Choose an existing complete cell as the driver without moving geometry or renumbering exclusions. */
export function rebaseLinearPattern(
  before: CadSketch,
  after: CadSketch,
  pattern: CadSketchPattern,
  x: number,
  y: number
): { ok: true; sketch: CadSketch; pattern: CadSketchPattern } | { ok: false; message: string } {
  const original =
    before.constraints.find(
      (c): c is CadSketchPattern => c.id === pattern.id && (c.type === 'linearPattern' || c.type === 'circularPattern')
    ) ?? pattern;
  const master = patternMaster(original),
    target = pattern.instances.find(i => i.x === x && i.y === y);
  if (!master || !target) return { ok: false, message: 'The pattern needs a complete surviving source instance.' };
  const copied = transformSketchEntities(
    { ...before, constraints: before.constraints.filter(c => c.id !== original.id) },
    {
      entityIds: original.seedKeys.map(key => master.idMap[key]!),
      translation: patternInstanceOffset(original, target),
      ...(original.type === 'circularPattern'
        ? {
            angle: (patternAngle(original, target) * 180) / Math.PI,
            pivot: before.entities.find(e => e.id === original.centerId) as CadPoint,
          }
        : {}),
      copy: true,
    }
  );
  if (!copied.ok) return copied;
  const realIds = new Map<string, string>();
  for (const [key, oldId] of Object.entries(master.idMap)) {
    const generated = copied.idMap.get(oldId),
      actual = target.idMap[key];
    if (generated && actual) realIds.set(generated, actual);
  }
  const next = structuredClone(after),
    oldIds = new Set(master.activeIds),
    beforeConstraintIds = new Set(before.constraints.map(c => c.id));
  const oldInternal = new Set(
    before.constraints.filter(c => constraintEntityIds(c).length > 0 && constraintEntityIds(c).every(id => oldIds.has(id))).map(c => c.id)
  );
  if (before.constraints.some(c => oldInternal.has(c.id) && (c.type === 'linearPattern' || c.type === 'circularPattern')))
    return { ok: false, message: 'Remove nested pattern relations before changing their source ownership.' };
  const survivingIds = new Set(next.constraints.map(c => c.id)),
    coupled = new Set<string>();
  for (const key of pattern.seedKeys)
    if (!patternExcluded(pattern, key, master.x, master.y)) {
      const entity = next.entities.find(e => e.id === master.idMap[key]);
      if (!entity) continue;
      coupled.add(entity.id);
      entityPointIds(entity).forEach(id => coupled.add(id));
      if (entity.type === 'spline' && !entity.closed) {
        coupled.add(splineHandleId(entity.id, 'start'));
        coupled.add(splineHandleId(entity.id, 'end'));
      }
    }
  const ruleKey = (c: import('./types').CadConstraint) =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries(c)
          .filter(([key]) => !['id', 'label', 'labelPlacement'].includes(key))
          .sort(([a], [b]) => a.localeCompare(b))
      )
    );
  const redundantCopies = new Set(
    before.constraints
      .filter(c => oldInternal.has(c.id) && survivingIds.has(c.id) && constraintEntityIds(c).every(id => coupled.has(id)))
      .map(c => ruleKey(remapCadReferences(c, copied.idMap)))
  );
  // Surviving drivers remain on their original geometry, including shared outside endpoints.
  next.constraints.push(
    ...copied.sketch.constraints
      .filter(c => !beforeConstraintIds.has(c.id) && !redundantCopies.has(ruleKey(c)))
      .map(c => remapCadReferences(c, realIds))
  );
  for (const id of copied.createdEntityIds)
    if (!realIds.has(id)) {
      const entity = copied.sketch.entities.find(e => e.id === id);
      if (entity && !next.entities.some(e => e.id === id)) next.entities.push(entity);
    }
  const updated = structuredClone(pattern),
    entities = new Map(before.entities.map(e => [e.id, e]));
  for (const instance of updated.instances) {
    if (instance.x === x && instance.y === y) {
      delete instance.constructionOverrides;
      continue;
    }
    instance.constructionOverrides = {
      ...instance.constructionOverrides,
      ...Object.fromEntries(
        updated.seedKeys.map(key => {
          const current = entities.get(instance.idMap[key]!),
            source = entities.get(master.idMap[key]!);
          return [key, !!(current?.construction ?? instance.constructionOverrides?.[key] ?? source?.construction)];
        })
      ),
    };
  }
  updated.masterX = x;
  updated.masterY = y;
  next.constraints = next.constraints.filter(c => c.id !== updated.id);
  next.constraints.push(updated);
  return { ok: true, sketch: materializePatternJoins(before, next, original, { x, y }), pattern: updated };
}
/** Entity deletion excludes only that seed/cell. A missing master rebases to a complete survivor or dissolves safely. */
export function afterPatternEntityRemoval(before: CadSketch, after: CadSketch, removed: ReadonlySet<string>): CadSketch {
  let next = after;
  for (const original of before.constraints.filter(
    (c): c is CadSketchPattern => c.type === 'linearPattern' || c.type === 'circularPattern'
  )) {
    if (!constraintEntityIds(original).some(id => removed.has(id))) continue;
    let group = structuredClone(original);
    for (const instance of group.instances)
      for (const key of group.seedKeys)
        if (removed.has(instance.idMap[key]!)) {
          if (!patternExcluded(group, key, instance.x, instance.y)) group.exclusions.push({ seedKey: key, x: instance.x, y: instance.y });
        }
    const entities = new Set(next.entities.map(e => e.id));
    const complete = (i: CadPatternInstance) =>
      group.seedKeys.every(key => !patternExcluded(group, key, i.x, i.y) && entities.has(i.idMap[key]!));
    const master = patternMaster(group);
    if (!master || !complete(master)) {
      const candidate = group.instances
        .filter(i => i.x < group.countX && i.y < group.countY && complete(i))
        .sort((a, b) => a.y - b.y || a.x - b.x)[0];
      if (!candidate) {
        next = materializePatternJoins(before, next, original);
        next = { ...next, constraints: next.constraints.filter(c => c.id !== group.id) };
        continue;
      }
      const rebased = rebaseLinearPattern(before, next, group, candidate.x, candidate.y);
      if (!rebased.ok) {
        next = materializePatternJoins(before, next, original);
        next = { ...next, constraints: next.constraints.filter(c => c.id !== group.id) };
        continue;
      }
      next = rebased.sketch;
      group = rebased.pattern;
    }
    const result = reconcileLinearPattern(next, group);
    if (result.ok) next = result.sketch;
    else {
      const released = materializePatternJoins(before, next, original);
      next = { ...released, constraints: released.constraints.filter(c => c.id !== group.id) };
    }
  }
  return removeUnusedPatternCenters(before, next);
}
export function patternDeletionNotice(before: CadSketch, after: CadSketch): string | null {
  for (const old of before.constraints.filter(c => c.type === 'linearPattern' || c.type === 'circularPattern')) {
    const next = after.constraints.find(c => c.id === old.id);
    if (next?.type !== 'linearPattern' && next?.type !== 'circularPattern')
      return 'The pattern was released because no complete source instance remained. Its surviving geometry is independently editable.';
    if (next.masterX !== old.masterX || next.masterY !== old.masterY)
      return 'The pattern source moved to a complete surviving instance; deleted cells remain excluded.';
  }
  return null;
}
