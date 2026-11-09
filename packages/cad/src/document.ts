import { slotIssue, removeUnusedSlotWidths } from './slot';
import { materializePatternJoins, removeUnusedPatternCenters } from './patternTopology';
import { linearPatternIssue, sketchPatternOwner, afterPatternEntityRemoval } from './pattern';
import { refreshDimensionMeasurement } from './dimensions';
import { cadVariableNameError } from './valueExpressions';
import { migrateDimensionPlacements } from './dimensionPlacement';
import { nestedDeeperThan } from './nestingDepth';
import { validPartCutSplit } from './partCutSplit';
import type {
  CadDirection,
  CadArcEntity,
  CadCircleEntity,
  CadConstraint,
  CadDocument,
  CadEntity,
  CadPart,
  CadPlacement,
  CadPoint,
  CadPointEntity,
  CadSketch,
  CadSplineEntity,
  NewCadConstraint,
} from './types';
import { elevateBezierData, evaluateCurvePoint, fitSplineData, insertRationalKnot, rationalCurveData } from './curves';
import { rectangleCorners } from './rectangleCorners';
import { isOwnedSplineHandle, splineHandleEntities, splineHandleIssue, splineHandleOwner, withSplineHandleSegments } from './splineHandles';

export const CAD_DOCUMENT_VERSION = 1;
export const newCadId = (): string => crypto.randomUUID();
export const originId = (sketch: CadSketch): string => `${sketch.id}:origin`;

export function createCadDocument(name = 'Untitled design'): CadDocument {
  return { version: 1, id: newCadId(), name, revision: 0, parts: [] };
}

export function createCadPart(name = 'Part 1', thickness = 18): CadPart {
  const sketch: CadSketch = { id: newCadId(), entities: [], constraints: [] };
  sketch.entities.push({ id: originId(sketch), type: 'point', x: 0, y: 0, fixed: true, construction: true });
  return { id: newCadId(), name, thickness, sketch };
}

export function createPlateDocument(options: { name?: string; width?: number; height?: number; thickness?: number } = {}): CadDocument {
  const document = createCadDocument(options.name ?? 'Plate');
  const part = createCadPart('Plate', options.thickness ?? 18);
  part.sketch = addRectangle(part.sketch, {
    x: 0,
    y: 0,
    width: options.width ?? 120,
    height: options.height ?? 80,
    dimensioned: true,
  });
  const firstEdge = part.sketch.entities.find(entity => entity.type === 'line')!;
  part.sketch = addConstraint(part.sketch, {
    type: 'coincident',
    pointAId: firstEdge.startId,
    pointBId: originId(part.sketch),
  });
  document.parts.push(part);
  return document;
}

export function addConstraint(sketch: CadSketch, constraint: NewCadConstraint): CadSketch {
  return { ...sketch, constraints: [...sketch.constraints, { ...constraint, id: constraint.id ?? newCadId() } as CadConstraint] };
}

export function removeConstraint(sketch: CadSketch, id: string): CadSketch {
  const constraint = sketch.constraints.find(c => c.id === id);
  const next =
    constraint?.type === 'linearPattern' || constraint?.type === 'circularPattern'
      ? materializePatternJoins(sketch, sketch, constraint)
      : sketch;
  return removeUnusedSlotWidths(
    sketch,
    removeUnusedPatternCenters(sketch, { ...next, constraints: next.constraints.filter(c => c.id !== id) })
  );
}

/** Each edit is a detached JSON value suitable for undo history and persistence. */
export function updateDimension(document: CadDocument, id: string, value: number, expression?: string): CadDocument {
  const sourceExpression = expression?.trim() || undefined;
  const next = migrateDimensionPlacements(document);
  let changed = false;
  for (const part of next.parts) {
    for (const c of part.sketch.constraints) {
      if (c.id === id && 'value' in c && !c.driven && (c.value !== value || c.expression !== sourceExpression)) {
        c.value = value;
        if (sourceExpression === undefined) delete c.expression;
        else c.expression = sourceExpression;
        changed = true;
      }
    }
  }
  if (changed) next.revision++;
  return next;
}

/** Convert a numeric driver to a reference, or restore driving at its current measured value. */
export function setDimensionDriven(document: CadDocument, id: string, driven: boolean): CadDocument {
  const next = migrateDimensionPlacements(document);
  let changed = false;
  for (const part of next.parts) {
    part.sketch.constraints = part.sketch.constraints.map(constraint => {
      if (constraint.id !== id || !('value' in constraint) || !!constraint.driven === driven) return constraint;
      changed = true;
      const measured = refreshDimensionMeasurement(part.sketch, constraint);
      if (driven) {
        const reference = { ...measured, driven: true };
        delete reference.expression;
        return reference;
      }
      const restored = { ...measured };
      delete restored.driven;
      return restored;
    });
  }
  if (changed) next.revision++;
  return next;
}

export function updatePoint(document: CadDocument, id: string, point: CadPoint): CadDocument {
  const next = migrateDimensionPlacements(document);
  let changed = false;
  for (const part of next.parts) {
    const e = part.sketch.entities.find((e): e is CadPointEntity => e.id === id && e.type === 'point');
    if (e && !e.fixed && (e.x !== point.x || e.y !== point.y)) {
      e.x = point.x;
      e.y = point.y;
      changed = true;
    }
  }
  if (changed) next.revision++;
  return next;
}

export function entityPointIds(entity: CadEntity): string[] {
  switch (entity.type) {
    case 'point':
      return [];
    case 'line':
      return [entity.startId, entity.endId];
    case 'ellipse':
      return [entity.centerId, entity.focusId, entity.majorStartId, entity.majorEndId, entity.minorStartId, entity.minorEndId];
    case 'circle':
      return [entity.centerId];
    case 'arc':
      return [entity.centerId, entity.startId, entity.endId];
    case 'conic':
      return [entity.startId, entity.controlId, entity.endId];
    case 'bezier':
      return [...entity.controlPointIds];
    case 'spline':
      return [...new Set([entity.startId, entity.endId, ...entity.controlPointIds, ...entity.fitPointIds])];
  }
}

export function constraintEntityIds(constraint: CadConstraint): string[] {
  if (constraint.type === 'slot')
    return Array.isArray(constraint.sourceIds) && Array.isArray(constraint.generatedIds)
      ? [...constraint.sourceIds, ...constraint.generatedIds, constraint.widthEntityId]
      : [];
  if (constraint.type === 'linearPattern' || constraint.type === 'circularPattern')
    return Array.isArray(constraint.instances)
      ? [
          ...new Set([
            ...(constraint.type === 'circularPattern' ? [constraint.centerId] : []),
            ...constraint.instances.flatMap(i => (i && Array.isArray(i.activeIds) ? i.activeIds : [])),
          ]),
        ]
      : [];
  if (constraint.type === 'offset')
    return Array.isArray(constraint.members)
      ? [...new Set(constraint.members.flatMap(member => (member ? [member.sourceId, member.targetId] : [])))]
      : [];
  if (constraint.type === 'symmetricCurves') return [constraint.entityAId, constraint.entityBId, constraint.lineId];
  if (constraint.type === 'regularPolygon') return [constraint.circleId, ...constraint.edgeIds];
  if (constraint.type === 'symmetricPoints') return [constraint.pointAId, constraint.pointBId, constraint.lineId];
  if ('sourceEntityId' in constraint && constraint.sourceEntityId !== undefined)
    return [constraint.pointAId, constraint.pointBId, constraint.sourceEntityId];
  if ('pointId' in constraint && 'entityId' in constraint) return [constraint.pointId, constraint.entityId];
  if ('entityId' in constraint) return [constraint.entityId];
  if ('entityAId' in constraint) return [constraint.entityAId, constraint.entityBId];
  if ('pointId' in constraint) return [constraint.pointId];
  return [constraint.pointAId, constraint.pointBId];
}

export function isSplineTangentHandle(sketch: CadSketch, entityId: string): boolean {
  return splineHandleOwner(sketch, entityId) !== undefined;
}

/** Deleting a point removes dependent curves; deleting a curve removes only unused points. */
export function removeEntity(sketch: CadSketch, id: string): CadSketch {
  // The origin, and the edges of the face the part is drawn on, are where the sketch starts from.
  if (id === originId(sketch) || sketch.entities.some(e => e.id === id && e.faceEdge)) return sketch;
  // Endpoint tangent handles belong to the fit spline definition. They remain
  // editable/dimensionable, but deleting a handle must never delete its curve.
  if (isSplineTangentHandle(sketch, id)) return sketch;
  const removed = new Set([id]);
  const dependents = new Map<string, string[]>();
  for (const entity of sketch.entities) {
    const refs = [...entityPointIds(entity), ...(isOwnedSplineHandle(entity) ? [entity.owner.splineId] : [])];
    for (const reference of refs) dependents.set(reference, [...(dependents.get(reference) ?? []), entity.id]);
  }
  const pending = [id];
  while (pending.length)
    for (const dependent of dependents.get(pending.pop()!) ?? []) {
      if (removed.has(dependent)) continue;
      removed.add(dependent);
      pending.push(dependent);
    }
  let entities = sketch.entities.filter(e => !removed.has(e.id));
  const used = new Set(entities.flatMap(entityPointIds));
  const removedPointIds = new Set(sketch.entities.filter(e => removed.has(e.id)).flatMap(entityPointIds));
  entities = entities.filter(e => {
    const remove = e.type === 'point' && !e.standalone && e.id !== originId(sketch) && removedPointIds.has(e.id) && !used.has(e.id);
    if (remove) removed.add(e.id);
    return !remove;
  });
  return removeUnusedSlotWidths(
    sketch,
    afterPatternEntityRemoval(
      sketch,
      {
        ...sketch,
        entities,
        constraints: sketch.constraints.filter(
          c => c.type === 'linearPattern' || c.type === 'circularPattern' || !constraintEntityIds(c).some(e => removed.has(e))
        ),
      },
      removed
    )
  );
}

function pointAt(sketch: CadSketch, p: CadPoint, construction?: boolean): CadPointEntity {
  // Reuse shared endpoints, including the fixed origin, when drawing a chain.
  const existing = sketch.entities.find((e): e is CadPointEntity => e.type === 'point' && Math.hypot(e.x - p.x, e.y - p.y) < 1e-7);
  return existing ?? { id: newCadId(), type: 'point', ...p, construction };
}

/** Standalone reference geometry stays editable and can later be constrained onto curves. */
export function addPoint(
  sketch: CadSketch,
  options: CadPoint & { construction?: boolean; fixed?: boolean; standalone?: boolean }
): CadSketch {
  return { ...sketch, entities: [...sketch.entities, { id: newCadId(), type: 'point', standalone: true, ...options }] };
}

export function addConic(
  sketch: CadSketch,
  options: { start: CadPoint; end: CadPoint; control: CadPoint; rho?: number; construction?: boolean }
): CadSketch {
  const rho = options.rho ?? 0.5;
  if (!Number.isFinite(rho) || rho <= 0 || rho >= 1) throw new Error('Conic rho must be between zero and one.');
  const entities = [...sketch.entities];
  const refs = [options.start, options.end].map(p => {
    const point = pointAt({ ...sketch, entities }, p, options.construction);
    if (!entities.some(e => e.id === point.id)) entities.push(point);
    return point.id;
  });
  const control = { id: newCadId(), type: 'point' as const, ...options.control, standalone: false, construction: true };
  entities.push(control, {
    id: newCadId(),
    type: 'conic',
    startId: refs[0]!,
    endId: refs[1]!,
    controlId: control.id,
    rho,
    construction: options.construction,
  });
  return { ...sketch, entities };
}

export function setConicRho(sketch: CadSketch, entityId: string, rho: number): CadSketch {
  if (sketchPatternOwner(sketch, entityId, true)) throw new Error('Edit the source conic to change a pattern shape.');
  if (!Number.isFinite(rho) || rho <= 0 || rho >= 1) throw new Error('Conic rho must be between zero and one.');
  return { ...sketch, entities: sketch.entities.map(e => (e.id === entityId && e.type === 'conic' ? { ...e, rho } : e)) };
}

export function addBezier(sketch: CadSketch, options: { points: CadPoint[]; construction?: boolean }): CadSketch {
  if (options.points.length < 2 || options.points.length > 16 || options.points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    throw new Error('A Bézier curve needs 2–16 finite control points (degree 1–15).');
  const entities = [...sketch.entities];
  const ids = options.points.map((p, i) => {
    const point =
      i === 0 || i === options.points.length - 1
        ? pointAt({ ...sketch, entities }, p, options.construction)
        : { id: newCadId(), type: 'point' as const, ...p, standalone: false, construction: true };
    if (!entities.some(e => e.id === point.id)) entities.push(point);
    return point.id;
  });
  entities.push({
    id: newCadId(),
    type: 'bezier',
    startId: ids[0]!,
    endId: ids.at(-1)!,
    controlPointIds: ids,
    construction: options.construction,
  });
  return { ...sketch, entities };
}

export function addSpline(sketch: CadSketch, options: { points: CadPoint[]; closed?: boolean; construction?: boolean }): CadSketch {
  const repeatedEnd =
    options.points.length > 3 &&
    Math.hypot(options.points[0]!.x - options.points.at(-1)!.x, options.points[0]!.y - options.points.at(-1)!.y) < 1e-7;
  const closed = options.closed ?? repeatedEnd,
    fitPoints = closed && repeatedEnd ? options.points.slice(0, -1) : options.points;
  const fit = fitSplineData(fitPoints, closed);
  const entities = [...sketch.entities];
  const fitPointIds = fitPoints.map(p => {
    const point = pointAt({ ...sketch, entities }, p, options.construction);
    if (!entities.some(e => e.id === point.id)) entities.push(point);
    return point.id;
  });
  const controlPointIds = fit.poles.map((p, i) => {
    if (!closed && (i === 0 || i === fit.poles.length - 1)) return i === 0 ? fitPointIds[0]! : fitPointIds.at(-1)!;
    const point = { id: newCadId(), type: 'point' as const, ...p, construction: true, standalone: false };
    entities.push(point);
    return point.id;
  });
  const spline: CadSplineEntity = {
    id: newCadId(),
    type: 'spline',
    startId: fitPointIds[0]!,
    endId: closed ? fitPointIds[0]! : fitPointIds.at(-1)!,
    controlPointIds,
    fitPointIds,
    fitParameters: fit.parameters,
    degree: fit.degree,
    knots: fit.knots,
    weights: fit.weights,
    closed,
    construction: options.construction,
  };
  entities.push(...splineHandleEntities(spline), spline);
  return { ...sketch, entities };
}

export function insertCurveControlPoint(sketch: CadSketch, entityId: string, parameter = 0.5): CadSketch {
  if (sketchPatternOwner(sketch, entityId, true)) throw new Error('Edit the source curve to change the control points of a pattern.');
  const curve = sketch.entities.find(e => e.id === entityId);
  if (curve?.type !== 'spline' && curve?.type !== 'bezier') throw new Error('Select a spline or Bézier curve to add a control point.');
  if (curve.type === 'spline' && curve.closed) throw new Error('Control insertion is currently available on open fit splines.');
  if (curve.type === 'spline' && curve.fitPointIds.length >= 64) throw new Error('A spline supports at most 64 fit points.');
  if (curve.controlPointIds.length >= (curve.type === 'bezier' ? 16 : 128))
    throw new Error('This curve has reached its control point limit.');
  const points = new Map(sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(e => [e.id, e]));
  if (curve.type === 'spline' && curve.fitParameters.some(t => Math.abs(t - parameter) < 1e-7))
    throw new Error('That location already has a spline fit point.');
  const data = rationalCurveData(curve, points),
    refined = curve.type === 'bezier' ? elevateBezierData(data) : insertRationalKnot(data, parameter);
  const newId = newCadId(),
    ids = [...curve.controlPointIds];
  ids.splice(
    curve.type === 'bezier' ? ids.length - 1 : 'insertedIndex' in refined ? (refined.insertedIndex as number) : ids.length - 1,
    0,
    newId
  );
  if (curve.type === 'spline') {
    // The visible white points have semantic identities independent of where the
    // knot-refinement algorithm inserts a new internal pole.
    for (const [id, slot] of [
      [curve.controlPointIds[1]!, 1],
      [curve.controlPointIds.at(-2)!, ids.length - 2],
    ] as const) {
      const previous = ids.indexOf(id);
      [ids[previous], ids[slot]] = [ids[slot]!, ids[previous]!];
    }
  }
  const protectedHandles = new Set<string>();
  if (curve.type === 'spline')
    for (const id of [curve.controlPointIds[1]!, curve.controlPointIds.at(-2)!])
      if (
        sketch.constraints.some(
          c =>
            (!('value' in c) || !c.driven) &&
            constraintEntityIds(c).some(
              reference =>
                reference === id || sketch.entities.some(e => e.id === reference && e.type !== 'spline' && entityPointIds(e).includes(id))
            )
        )
      )
        protectedHandles.add(id);
  const replacements = new Map(ids.map((id, i) => [id, refined.poles[i]!]));
  const entities = sketch.entities.map(e =>
    e.type === 'point' && !e.fixed && !protectedHandles.has(e.id) && replacements.has(e.id) ? { ...e, ...replacements.get(e.id)! } : e
  );
  const inserted = refined.poles[ids.indexOf(newId)]!;
  entities.push({ id: newId, type: 'point', ...inserted, standalone: false, construction: true });
  const fitId = newCadId(),
    fit = evaluateCurvePoint(curve, points, parameter);
  const fitPointIds = curve.type === 'spline' ? [...curve.fitPointIds] : [],
    fitParameters = curve.type === 'spline' ? [...curve.fitParameters] : [];
  if (curve.type === 'spline') {
    const index = fitParameters.findIndex(t => t > parameter);
    fitPointIds.splice(index, 0, fitId);
    fitParameters.splice(index, 0, parameter);
    entities.push({ id: fitId, type: 'point', ...fit, standalone: false });
  }
  return {
    ...sketch,
    entities: entities.map(e =>
      e.id !== curve.id
        ? e
        : e.type === 'bezier'
          ? { ...e, controlPointIds: ids }
          : e.type === 'spline'
            ? { ...e, controlPointIds: ids, weights: refined.weights, knots: refined.knots, fitPointIds, fitParameters }
            : e
    ),
  };
}

/** Fit handles are always visible; construction controls are shown for a selected curve. */
export function visibleSketchPointIds(sketch: CadSketch, selectedEntityIds: readonly string[] = []): Set<string> {
  const hidden = new Set<string>(),
    visible = new Set<string>();
  for (const entity of sketch.entities) {
    if (entity.type === 'ellipse') hidden.add(entity.focusId);
    if (entity.type === 'conic') visible.add(entity.controlId);
    if (entity.type === 'bezier') entity.controlPointIds.forEach(id => visible.add(id));
    if (entity.type === 'spline') {
      entity.controlPointIds.forEach(id => hidden.add(id));
      entity.fitPointIds.forEach(id => visible.add(id));
      if (!entity.closed) {
        visible.add(entity.controlPointIds[1]!);
        visible.add(entity.controlPointIds.at(-2)!);
      }
    }
    if (entity.type !== 'point' && entity.type !== 'spline' && selectedEntityIds.includes(entity.id))
      entityPointIds(entity)
        .filter(id => entity.type !== 'ellipse' || id !== entity.focusId)
        .forEach(id => visible.add(id));
  }
  return new Set(
    sketch.entities
      .filter((e): e is CadPointEntity => e.type === 'point' && (!hidden.has(e.id) || visible.has(e.id) || !!e.standalone))
      .map(e => e.id)
  );
}

export function addLine(
  sketch: CadSketch,
  options: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    construction?: boolean;
  }
): CadSketch {
  const a = pointAt(sketch, { x: options.x1, y: options.y1 }, options.construction);
  const b = pointAt(sketch, { x: options.x2, y: options.y2 }, options.construction);
  const entities = [...sketch.entities];
  for (const p of [a, b]) if (!entities.some(e => e.id === p.id)) entities.push(p);
  entities.push({ id: newCadId(), type: 'line', startId: a.id, endId: b.id, construction: options.construction });
  return { ...sketch, entities };
}

export function addRectangle(
  sketch: CadSketch,
  options: {
    x: number;
    y: number;
    width: number;
    height: number;
    construction?: boolean;
    /** Intentional numeric creation: constrain the size rather than only providing an initial shape. */
    dimensioned?: boolean;
    /** Explicitly constrain the lower-left location. Free drawing never adds these dimensions. */
    positioned?: boolean;
  }
): CadSketch {
  const { x, y, width: w, height: h, construction } = options;
  const corners: [CadPoint, CadPoint, CadPoint, CadPoint] = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
  const graph = rectangleCorners(corners, { createId: newCadId, construction });
  const entities = [...sketch.entities, ...graph.entities];
  const [bottom, right, top, left] = graph.edges;
  const constraints: CadConstraint[] = [
    ...sketch.constraints,
    ...graph.coincidences,
    { id: newCadId(), type: 'horizontal', entityId: bottom.id },
    { id: newCadId(), type: 'parallel', entityAId: bottom.id, entityBId: top.id },
    { id: newCadId(), type: 'parallel', entityAId: right.id, entityBId: left.id },
    { id: newCadId(), type: 'perpendicular', entityAId: bottom.id, entityBId: right.id },
  ];
  if (options.dimensioned)
    constraints.push(
      {
        id: newCadId(),
        type: 'distanceX',
        pointAId: bottom.startId,
        pointBId: bottom.endId,
        value: w,
        label: 'Width',
        sourceEntityId: bottom.id,
      },
      {
        id: newCadId(),
        type: 'distanceY',
        pointAId: right.startId,
        pointBId: right.endId,
        value: h,
        label: 'Height',
        sourceEntityId: right.id,
      }
    );
  if (options.positioned)
    constraints.push(
      { id: newCadId(), type: 'positionX', pointId: bottom.startId, value: x, label: 'X' },
      { id: newCadId(), type: 'positionY', pointId: bottom.startId, value: y, label: 'Y' }
    );
  return { ...sketch, entities, constraints };
}

/** A center rectangle keeps its clicked center through a persistent diagonal midpoint relation. */
export function addCenterRectangle(
  sketch: CadSketch,
  options: {
    x: number;
    y: number;
    width: number;
    height: number;
    construction?: boolean;
    /** Constrain width and height for intentional numeric creation. */
    dimensioned?: boolean;
    /** Add explicit center X/Y dimensions; omitted for free drawing. */
    positioned?: boolean;
  }
): CadSketch {
  const { x, y, width, height } = options;
  // A matching coordinate is not an external attachment. The caller's explicit snap relation owns that intent.
  const center: CadPointEntity = { id: newCadId(), type: 'point', x, y, construction: true, standalone: false };
  const centered = { ...sketch, entities: [...sketch.entities, center] };
  const rectangle = addRectangle(centered, {
    ...options,
    x: x - width / 2,
    y: y - height / 2,
    positioned: false,
  });
  const edges = rectangle.entities.slice(centered.entities.length).filter(e => e.type === 'line');
  const first = edges[0]!,
    opposite = edges[2]!;
  const diagonalId = newCadId();
  const entities: CadEntity[] = [
    ...rectangle.entities,
    { id: diagonalId, type: 'line', startId: first.startId, endId: opposite.startId, construction: true },
    { id: newCadId(), type: 'line', startId: first.endId, endId: opposite.endId, construction: true },
  ];
  const constraints: CadConstraint[] = [
    ...rectangle.constraints,
    { id: newCadId(), type: 'midpoint', pointId: center.id, entityId: diagonalId },
  ];
  if (options.positioned)
    constraints.push(
      { id: newCadId(), type: 'positionX', pointId: center.id, value: x, label: 'Center X' },
      { id: newCadId(), type: 'positionY', pointId: center.id, value: y, label: 'Center Y' }
    );
  return { ...sketch, entities, constraints };
}

export function addCircle(
  sketch: CadSketch,
  options: {
    x: number;
    y: number;
    radius: number;
    construction?: boolean;
    /** Constrain diameter for intentional numeric creation. */
    dimensioned?: boolean;
    /** Add explicit center X/Y dimensions; omitted for free drawing. */
    positioned?: boolean;
  }
): CadSketch {
  const center = pointAt(sketch, { x: options.x, y: options.y }, options.construction);
  const circle: CadCircleEntity = {
    id: newCadId(),
    type: 'circle',
    centerId: center.id,
    radius: options.radius,
    construction: options.construction,
  };
  const entities = sketch.entities.some(e => e.id === center.id) ? [...sketch.entities, circle] : [...sketch.entities, center, circle];
  const constraints: CadConstraint[] = [...sketch.constraints];
  if (options.dimensioned)
    constraints.push({ id: newCadId(), type: 'diameter', entityId: circle.id, value: 2 * options.radius, label: 'Diameter' });
  if (options.positioned && !center.fixed)
    constraints.push(
      { id: newCadId(), type: 'positionX', pointId: center.id, value: options.x, label: 'Center X' },
      { id: newCadId(), type: 'positionY', pointId: center.id, value: options.y, label: 'Center Y' }
    );
  return { ...sketch, entities, constraints };
}

export function addArc(
  sketch: CadSketch,
  options: {
    cx: number;
    cy: number;
    radius: number;
    startAngle: number;
    endAngle: number;
    construction?: boolean;
  }
): CadSketch {
  const { cx, cy, radius, startAngle, endAngle, construction } = options;
  const points = [
    pointAt(sketch, { x: cx, y: cy }, construction),
    pointAt(sketch, { x: cx + radius * Math.cos(startAngle), y: cy + radius * Math.sin(startAngle) }, construction),
    pointAt(sketch, { x: cx + radius * Math.cos(endAngle), y: cy + radius * Math.sin(endAngle) }, construction),
  ];
  const entities = [...sketch.entities];
  for (const p of points) if (!entities.some(e => e.id === p.id)) entities.push(p);
  const arc: CadArcEntity = {
    id: newCadId(),
    type: 'arc',
    centerId: points[0]!.id,
    startId: points[1]!.id,
    endId: points[2]!.id,
    radius,
    startAngle,
    endAngle,
    construction,
  };
  entities.push(arc);
  return { ...sketch, entities };
}

/** Reject invalid source shapes early when loading portable documents. Geometric errors stay editable. */
export function parseCadDocument(input: unknown): CadDocument {
  // Saved designs nest about ten levels; far deeper input is not one, and would overflow the stack while loading.
  if (!input || typeof input !== 'object' || nestedDeeperThan(input, 64)) throw new Error('Invalid CAD document');
  const d = input as CadDocument;
  if (
    (d.version !== 1 && d.version !== 2) ||
    typeof d.id !== 'string' ||
    typeof d.name !== 'string' ||
    !Number.isSafeInteger(d.revision) ||
    d.revision < 0 ||
    !Array.isArray(d.parts) ||
    (d.version === 2 && !d.parts.some(p => p?.features?.length))
  )
    throw new Error('Invalid CAD document');
  const ids = new Set<string>([d.id]);
  const addId = (id: unknown, into = ids) => {
    if (typeof id !== 'string' || !id || into.has(id)) throw new Error('CAD IDs must be unique nonempty strings');
    into.add(id);
  };
  const number = (value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('CAD numeric fields must be finite numbers');
  };
  const reference = (value: unknown) => {
    if (typeof value !== 'string' || !value) throw new Error('CAD references must be nonempty strings');
  };
  if (d.variables !== undefined) {
    if (!Array.isArray(d.variables)) throw new Error('Invalid CAD variables');
    const names = new Set<string>();
    for (const variable of d.variables) {
      if (!variable || typeof variable !== 'object') throw new Error('Invalid CAD variable');
      addId(variable.id);
      if (typeof variable.name !== 'string' || cadVariableNameError(variable.name) || names.has(variable.name))
        throw new Error('Invalid CAD variable name');
      if (typeof variable.expression !== 'string') throw new Error('Invalid CAD variable');
      names.add(variable.name);
    }
  }
  if (d.planes !== undefined) {
    if (!Array.isArray(d.planes)) throw new Error('Invalid CAD planes');
    for (const plane of d.planes) {
      if (!plane || typeof plane !== 'object' || typeof plane.name !== 'string') throw new Error('Invalid CAD plane');
      addId(plane.id);
      const on = plane.on;
      if (!on || typeof on !== 'object' || ('plane' in on ? !['top', 'front', 'right'].includes(on.plane) : typeof on.partId !== 'string'))
        throw new Error('Invalid CAD plane');
      if (plane.offsetExpression !== undefined && typeof plane.offsetExpression !== 'string') throw new Error('Invalid CAD plane');
      number(plane.offset);
    }
  }
  const checkPlacement = (placement: CadPlacement) => {
    const { position, rotation, positionExpressions } = placement ?? ({} as CadPlacement);
    if (!Array.isArray(position) || position.length !== 3 || !Array.isArray(rotation) || rotation.length !== 4)
      throw new Error('Invalid CAD placement');
    [...position, ...rotation].forEach(number);
    if (Math.abs(Math.hypot(...rotation) - 1) > 1e-6) throw new Error('Invalid CAD placement');
    if (
      positionExpressions !== undefined &&
      (!Array.isArray(positionExpressions) ||
        positionExpressions.length !== 3 ||
        positionExpressions.some(e => e !== null && typeof e !== 'string'))
    )
      throw new Error('Invalid CAD placement');
  };
  const checkDirection = (direction: CadDirection) => {
    const { along, flip } = direction ?? ({} as CadDirection);
    const face = along && typeof along === 'object' && 'face' in along ? along.face : undefined;
    if (
      !along ||
      typeof along !== 'object' ||
      ('plane' in along
        ? !['top', 'front', 'right'].includes(along.plane)
        : typeof along.partId !== 'string' ||
          !(face === 'top' || face === 'underside' || (face && typeof face === 'object' && typeof face.edge === 'string'))) ||
      (flip !== undefined && typeof flip !== 'boolean')
    )
      throw new Error('Invalid CAD direction');
  };
  if (d.partCuts !== undefined) {
    if (!Array.isArray(d.partCuts)) throw new Error('Invalid CAD part cuts');
    for (const step of d.partCuts) {
      if (!step || typeof step !== 'object' || !Array.isArray(step.tools) || !Array.isArray(step.targets))
        throw new Error('Invalid CAD part cut');
      addId(step.id);
      [...step.tools, ...step.targets].forEach(reference);
      number(step.clearance);
      if (!validPartCutSplit(step.split)) throw new Error('Invalid CAD part cut');
      if (step.clearanceExpression !== undefined && typeof step.clearanceExpression !== 'string') throw new Error('Invalid CAD part cut');
      if (step.consumeTools !== undefined && step.consumeTools !== true) throw new Error('Invalid CAD part cut');
    }
  }
  for (const p of d.parts) {
    if (!p || typeof p !== 'object' || !p.sketch || typeof p.sketch !== 'object') throw new Error('Invalid CAD part');
    addId(p.id);
    if (
      typeof p.name !== 'string' ||
      typeof p.thickness !== 'number' ||
      !Array.isArray(p.sketch.entities) ||
      !Array.isArray(p.sketch.constraints)
    )
      throw new Error('Invalid CAD part');
    number(p.thickness);
    for (const key of ['thicknessExpression', 'sketchName', 'extrudeName'] as const)
      if (p[key] !== undefined && typeof p[key] !== 'string') throw new Error('Invalid CAD part');
    if (p.thin !== undefined) {
      if (!p.thin || typeof p.thin !== 'object') throw new Error('Invalid thin extrude');
      number(p.thin.depth);
      if (p.thin.depth <= 0) throw new Error('Invalid thin extrude');
      if (p.thin.depthExpression !== undefined && typeof p.thin.depthExpression !== 'string') throw new Error('Invalid thin extrude');
      if (p.thin.midPlane !== undefined && typeof p.thin.midPlane !== 'boolean') throw new Error('Invalid thin extrude');
    }
    for (const regions of [p.regions, p.addedRegions])
      if (regions !== undefined && (!Array.isArray(regions) || !regions.every(id => typeof id === 'string')))
        throw new Error('Invalid CAD part regions');
    for (const id of [p.sketchOf, p.addTo]) if (id !== undefined) reference(id);
    if (p.remove !== undefined) {
      if (!p.remove || typeof p.remove !== 'object') throw new Error('Invalid extrude remove');
      if (p.remove.depth !== 'through') number(p.remove.depth);
      if (p.remove.depthExpression !== undefined && typeof p.remove.depthExpression !== 'string') throw new Error('Invalid extrude remove');
    }
    if (p.cornerRelief !== undefined) {
      if (!p.cornerRelief || typeof p.cornerRelief !== 'object') throw new Error('Invalid corner relief');
      number(p.cornerRelief.diameter);
      if (p.cornerRelief.diameter <= 0) throw new Error('Invalid corner relief');
      if (p.cornerRelief.diameterExpression !== undefined && typeof p.cornerRelief.diameterExpression !== 'string')
        throw new Error('Invalid corner relief');
    }
    if (p.copies !== undefined) {
      if (!Array.isArray(p.copies)) throw new Error('Invalid CAD part copies');
      for (const copy of p.copies) {
        if (!copy || typeof copy !== 'object') throw new Error('Invalid CAD part copy');
        addId(copy.id);
        if (copy.mirrored !== undefined && typeof copy.mirrored !== 'boolean') throw new Error('Invalid CAD part copy');
        if (copy.name !== undefined && typeof copy.name !== 'string') throw new Error('Invalid CAD part copy');
        if (copy.pattern !== undefined && typeof copy.pattern !== 'string') throw new Error('Invalid CAD part copy');
        if (copy.placement !== undefined) checkPlacement(copy.placement);
        if (copy.along !== undefined) {
          checkDirection(copy.along);
          number(copy.along.distance);
          if (copy.along.distanceExpression !== undefined && typeof copy.along.distanceExpression !== 'string')
            throw new Error('Invalid CAD copy distance expression');
        }
      }
    }
    if (p.pattern !== undefined) {
      if (p.pattern?.direction !== undefined) checkDirection(p.pattern.direction);
      const vector = p.pattern?.vector;
      if (
        vector !== undefined &&
        !(Array.isArray(vector) && vector.length === 3 && vector.every(Number.isFinite) && Math.hypot(...vector) > 0)
      )
        throw new Error('Invalid CAD pattern vector');
      const { id, axis, count, spacing, countExpression, spacingExpression } = p.pattern ?? ({} as NonNullable<CadPart['pattern']>);
      if (
        typeof id !== 'string' ||
        !['x', 'y', 'z'].includes(axis) ||
        !Number.isInteger(count) ||
        count < 1 ||
        count > 200 ||
        !Number.isFinite(spacing) ||
        (countExpression !== undefined && typeof countExpression !== 'string') ||
        (spacingExpression !== undefined && typeof spacingExpression !== 'string')
      )
        throw new Error('Invalid CAD part pattern');
    }
    if (p.placement !== undefined) checkPlacement(p.placement);
    if (p.drawnOn !== undefined) {
      const { on, offset, offsetExpression, inward } = p.drawnOn ?? ({} as NonNullable<CadPart['drawnOn']>);
      const face = on && typeof on === 'object' && 'face' in on ? on.face : undefined;
      if (
        !on ||
        typeof on !== 'object' ||
        ('plane' in on
          ? !['top', 'front', 'right'].includes(on.plane)
          : typeof on.partId !== 'string' ||
            !(face === 'top' || face === 'underside' || (typeof face === 'object' && face && typeof face.edge === 'string'))) ||
        (offsetExpression !== undefined && typeof offsetExpression !== 'string') ||
        (inward !== undefined && typeof inward !== 'boolean') ||
        (p.drawnOn.datum !== undefined && !d.planes?.some(plane => plane.id === p.drawnOn!.datum))
      )
        throw new Error('Invalid CAD part support');
      number(offset);
    }
    if (d.version === 1 && p.features !== undefined) throw new Error('Invalid CAD document');
    if (p.features !== undefined && !Array.isArray(p.features)) throw new Error('Invalid CAD features');
    // A shared sketch, and a Remove step's sketch on the board it cuts, are copies: their IDs are the original's, so
    // they're checked against IDs of their own. Loading migrates every sketch, so each is checked.
    const sketches: [CadSketch, boolean][] = [[p.sketch, !p.sketchOf]];
    for (const f of p.features ?? []) {
      if (!f || typeof f !== 'object') throw new Error('Invalid CAD feature');
      addId(f.id);
      if (f.type === 'sketch') {
        if (!f.sketch || typeof f.sketch !== 'object' || !Array.isArray(f.sketch.entities) || !Array.isArray(f.sketch.constraints))
          throw new Error('Invalid CAD feature');
        if (f.on !== 'top' && f.on !== 'underside' && (typeof f.on !== 'object' || !f.on)) throw new Error('Invalid CAD feature');
        if (typeof f.on === 'object') reference(f.on.floorOf);
        if (f.removedBy !== undefined) reference(f.removedBy);
        sketches.push([f.sketch, f.removedBy === undefined]);
      } else if (f.type === 'cut') {
        reference(f.sketchId);
        reference(f.regionId);
        if (f.depth !== 'through') number(f.depth);
        if (f.suppressed !== undefined && typeof f.suppressed !== 'boolean') throw new Error('Invalid CAD feature');
        if (f.depthExpression !== undefined && (typeof f.depthExpression !== 'string' || f.depth === 'through'))
          throw new Error('Invalid CAD feature');
      } else throw new Error('Invalid CAD feature');
    }
    for (const [sketch, own] of sketches) {
      const scope = own ? ids : new Set<string>();
      const add = (id: unknown) => addId(id, scope);
      add(sketch.id);
      for (const e of sketch.entities) {
        if (!e || typeof e !== 'object') throw new Error('Invalid CAD entity');
        add(e.id);
        if (!['point', 'line', 'circle', 'ellipse', 'arc', 'conic', 'bezier', 'spline'].includes(e.type))
          throw new Error('Unknown CAD entity');
        if (e.construction !== undefined && typeof e.construction !== 'boolean') throw new Error('Invalid construction flag');
        if (e.type === 'point') {
          number(e.x);
          number(e.y);
          if (e.fixed !== undefined && typeof e.fixed !== 'boolean') throw new Error('Invalid fixed flag');
          if (e.standalone !== undefined && typeof e.standalone !== 'boolean') throw new Error('Invalid standalone point flag');
        } else {
          if (e.type === 'bezier' || e.type === 'spline') {
            if (!Array.isArray(e.controlPointIds)) throw new Error('Invalid curve controls');
          }
          if (e.type === 'spline') {
            if (![e.fitPointIds, e.fitParameters, e.knots, e.weights].every(Array.isArray)) throw new Error('Invalid spline data');
            e.fitPointIds.forEach(reference);
            e.fitParameters.forEach(number);
            e.knots.forEach(number);
            e.weights.forEach(number);
            number(e.degree);
            if (e.closed !== undefined && typeof e.closed !== 'boolean') throw new Error('Invalid closed spline flag');
          }
          if (e.type === 'ellipse') {
            number(e.radius);
            if (!['major', 'minor'].includes(e.primaryAxis)) throw new Error('Invalid ellipse primary axis');
          }
          if (e.type === 'conic') number(e.rho);
          entityPointIds(e).forEach(reference);
          if (e.type === 'circle' || e.type === 'arc') number(e.radius);
          if (e.type === 'arc') {
            number(e.startAngle);
            number(e.endAngle);
          }
        }
      }
      const entityMap = new Map(sketch.entities.map(e => [e.id, e]));
      for (const entity of sketch.entities) {
        const issue = splineHandleIssue(entity, entityMap);
        if (issue) throw new Error(issue);
      }
      for (const c of sketch.constraints) {
        if (!c || typeof c !== 'object') throw new Error('Invalid CAD constraint');
        add(c.id);
        if (
          ![
            'horizontal',
            'vertical',
            'coincident',
            'symmetricPoints',
            'symmetricCurves',
            'regularPolygon',
            'linearPattern',
            'circularPattern',
            'slot',
            'horizontalPoints',
            'verticalPoints',
            'pointOnLine',
            'pointOnCircle',
            'pointOnCurve',
            'midpoint',
            'distance',
            'distanceX',
            'distanceY',
            'pointLineDistance',
            'lineLineDistance',
            'pointArcDistance',
            'lineCircleDistance',
            'circleCircleDistance',
            'radius',
            'diameter',
            'positionX',
            'positionY',
            'parallel',
            'perpendicular',
            'equal',
            'tangent',
            'angle',
            'offset',
          ].includes(c.type)
        )
          throw new Error('Unknown CAD constraint');
        if (c.label !== undefined && typeof c.label !== 'string') throw new Error('Invalid constraint label');
        if (c.type === 'slot') {
          const issue = slotIssue(sketch, c);
          if (issue) throw new Error(issue);
        }
        if (c.type === 'symmetricCurves' && c.focusSign !== undefined && c.focusSign !== 1 && c.focusSign !== -1)
          throw new Error('Invalid ellipse symmetry branch.');
        if (c.type === 'linearPattern' || c.type === 'circularPattern') {
          if (
            !Array.isArray(c.seedKeys) ||
            !c.seedKeys.length ||
            c.seedKeys.some(key => typeof key !== 'string') ||
            new Set(c.seedKeys).size !== c.seedKeys.length ||
            !Array.isArray(c.instances) ||
            !Array.isArray(c.exclusions) ||
            (c.type === 'linearPattern' && (!c.stepX || !c.stepY))
          )
            throw new Error('Invalid linear pattern data.');
          [c.masterX, c.masterY, c.countX, c.countY].forEach(number);
          if (c.type === 'linearPattern') {
            [c.stepX.x, c.stepX.y, c.stepY.x, c.stepY.y].forEach(number);
            const typed = c.expressions;
            if (
              typed !== undefined &&
              (!typed ||
                typeof typed !== 'object' ||
                Object.entries(typed).some(
                  ([key, value]) =>
                    !['countX', 'countY', 'spacingX', 'spacingY'].includes(key) || (value !== undefined && typeof value !== 'string')
                ))
            )
              throw new Error('Invalid pattern expressions');
          } else {
            number(c.angle);
            if (typeof c.centerId !== 'string' || typeof c.closed !== 'boolean')
              throw new Error('Invalid circular pattern center or sweep.');
          }
          for (const i of c.instances) {
            if (
              !i ||
              !i.idMap ||
              typeof i.idMap !== 'object' ||
              Array.isArray(i.idMap) ||
              !Array.isArray(i.activeIds) ||
              Object.values(i.idMap).some(id => typeof id !== 'string') ||
              i.activeIds.some(id => typeof id !== 'string')
            )
              throw new Error('Invalid pattern instance map.');
            number(i.x);
            number(i.y);
          }
          for (const e of c.exclusions) {
            if (!e || typeof e.seedKey !== 'string') throw new Error('Invalid pattern exclusion.');
            number(e.x);
            number(e.y);
          }
          const issue = linearPatternIssue(sketch, c);
          if (issue) throw new Error(issue);
        }
        if (c.type === 'regularPolygon') {
          if (
            !['inscribed', 'circumscribed'].includes(c.mode) ||
            !Array.isArray(c.edgeIds) ||
            c.edgeIds.length < 3 ||
            c.edgeIds.length > 50 ||
            new Set(c.edgeIds).size !== c.edgeIds.length
          )
            throw new Error('Invalid regular polygon relation.');
          reference(c.circleId);
          c.edgeIds.forEach(reference);
        }
        if (c.type === 'offset') {
          if (!Array.isArray(c.members) || c.members.length === 0) throw new Error('An offset needs copied geometry.');
          for (const member of c.members) {
            if (!member || !['line', 'circle', 'arc'].includes(member.kind) || (member.side !== 1 && member.side !== -1))
              throw new Error('Invalid offset member.');
            if ((member.kind === 'line' || member.kind === 'arc') && typeof member.endpoints !== 'boolean')
              throw new Error('Invalid offset endpoint relationship.');
            reference(member.sourceId);
            reference(member.targetId);
          }
        }
        if (c.labelPosition !== undefined) {
          if (!c.labelPosition || typeof c.labelPosition !== 'object') throw new Error('Invalid constraint label position');
          number(c.labelPosition.x);
          number(c.labelPosition.y);
        }
        if ('labelPlacement' in c && c.labelPlacement !== undefined) {
          if (!('value' in c) || !c.labelPlacement || typeof c.labelPlacement !== 'object')
            throw new Error('Invalid dimension label placement');
          const placement = c.labelPlacement;
          if (placement.kind === 'linear') {
            if (c.type === 'radius' || c.type === 'diameter' || c.type === 'angle')
              throw new Error('Invalid dimension label placement kind');
            number(placement.fraction);
            number(placement.normalOffset);
            if (placement.overshoot !== undefined) number(placement.overshoot);
          } else if (placement.kind === 'radial') {
            if (c.type !== 'radius' && c.type !== 'diameter') throw new Error('Invalid dimension label placement kind');
            number(placement.angle);
            number(placement.radiusRatio);
            if (placement.radiusRatio < 0) throw new Error('Invalid dimension label radius ratio');
            if (placement.radiusOffset !== undefined) {
              number(placement.radiusOffset);
              if (placement.radiusOffset < 0) throw new Error('Invalid dimension label radius offset');
            }
            if (placement.distance !== undefined) {
              number(placement.distance);
              if (placement.distance < 0) throw new Error('Invalid dimension label distance');
            }
          } else if (placement.kind === 'angle') {
            if (c.type !== 'angle') throw new Error('Invalid dimension label placement kind');
            number(placement.radius);
            number(placement.angleOffset);
            if (placement.radius < 0) throw new Error('Invalid dimension label radius');
            if (placement.frame !== undefined && placement.frame !== 'local') throw new Error('Invalid dimension label frame');
          } else if (placement.kind === 'fallback') {
            if (!placement.offset || typeof placement.offset !== 'object') throw new Error('Invalid dimension label fallback');
            number(placement.offset.x);
            number(placement.offset.y);
          } else throw new Error('Invalid dimension label placement kind');
        }
        if ('sourceEntityId' in c && c.sourceEntityId !== undefined) {
          if (c.type !== 'distance' && c.type !== 'distanceX' && c.type !== 'distanceY')
            throw new Error('Only point-pair dimensions can reference a source line');
          reference(c.sourceEntityId);
        }
        constraintEntityIds(c).forEach(reference);
        if ((c.type === 'pointArcDistance' || c.type === 'lineCircleDistance') && c.side !== 'inside' && c.side !== 'outside')
          throw new Error('Invalid circular distance side');
        if (
          (c.type === 'pointArcDistance' || c.type === 'lineCircleDistance') &&
          c.radiusSide !== undefined &&
          c.radiusSide !== 'near' &&
          c.radiusSide !== 'far'
        )
          throw new Error('Invalid circular witness side');
        if (c.type === 'circleCircleDistance' && ![c.radiusASign, c.radiusBSign, c.direction].every(value => value === 1 || value === -1))
          throw new Error('Invalid circular dimension direction');
        if ('expression' in c && c.expression !== undefined && (!('value' in c) || typeof c.expression !== 'string'))
          throw new Error('Invalid dimension expression');
        if ('driven' in c && c.driven !== undefined && (!('value' in c) || typeof c.driven !== 'boolean'))
          throw new Error('Invalid driven dimension flag');
        if (c.type === 'angle') {
          if (c.orientation !== undefined && c.orientation !== 1 && c.orientation !== -1)
            throw new Error('Invalid angular dimension orientation');
          if ([c.reversedA, c.reversedB].some(value => value !== undefined && typeof value !== 'boolean'))
            throw new Error('Invalid angular dimension ray');
        }
        if (c.type === 'pointOnCurve') {
          number(c.parameter);
          if (c.parameterFixed !== undefined && typeof c.parameterFixed !== 'boolean') throw new Error('Invalid curve parameter flag');
        }
        if (
          [
            'distance',
            'distanceX',
            'distanceY',
            'pointLineDistance',
            'lineLineDistance',
            'pointArcDistance',
            'lineCircleDistance',
            'circleCircleDistance',
            'radius',
            'diameter',
            'positionX',
            'positionY',
            'angle',
            'offset',
          ].includes(c.type)
        )
          number((c as { value: unknown }).value);
      }
    }
  }
  const parsed = migrateDimensionPlacements(d);
  for (const part of parsed.parts) {
    part.sketch = withSplineHandleSegments(part.sketch);
    for (const feature of part.features ?? []) if (feature.type === 'sketch') feature.sketch = withSplineHandleSegments(feature.sketch);
  }
  return parsed;
}
