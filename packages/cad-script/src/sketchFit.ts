import {
  addConstraint,
  constraintEntityIds,
  entityPointIds,
  newCadId,
  type CadConstraint,
  type CadEntity,
  type CadPointEntity,
  type CadSketch,
} from '@wbcnc/cad';
import { fail } from './editExisting';
import { measuredSketchBounds } from './curveBounds';
import type { CadSketchSelection, Len, SketchEdit } from './editTypes';
import type { SketchCurveContext } from './sketchCurves';

export function fitSketchBounds(
  context: SketchCurveContext,
  items: CadSketchSelection,
  options: Parameters<SketchEdit['fitBounds']>[1]
): ReturnType<SketchEdit['fitBounds']> {
  const { current, apply, measure, lengthTerm: lengthExpression } = context,
    before = current();
  const selected = new Set(
    items.flatMap(item =>
      'edges' in item
        ? Array.isArray(item.edges)
          ? item.edges.map(edge => edge.id)
          : Object.values(item.edges).map(edge => edge.id)
        : [item.id]
    )
  );
  if (
    !selected.size ||
    [...selected].some(id => !before.entities.some(e => e.id === id && e.type !== 'point' && !(e.type === 'line' && e.owner)))
  )
    return fail('fitBounds needs existing sketch curves, not points or spline tangent handles.');
  let source: ReturnType<typeof measuredSketchBounds>;
  try {
    source = measuredSketchBounds(before, selected);
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Could not measure this profile.');
  }
  const w = measure(options.w, 'Fit width'),
    h = measure(options.h, 'Fit height'),
    at = options.at ?? [0, 0];
  if (!(w > 0 && h > 0 && source.size[0] > 1e-7 && source.size[1] > 1e-7))
    return fail('fitBounds needs positive target dimensions and a profile with nonzero measured width and height.');
  const scalar = Math.min(w / source.size[0], h / source.size[1]);
  const scales: [number, number] = options.preserveAspect ? [scalar, scalar] : [w / source.size[0], h / source.size[1]];
  const uniform = Math.abs(scales[0] - scales[1]) < 1e-10 * Math.max(...scales);
  if (!uniform && before.entities.some(e => selected.has(e.id) && ['circle', 'arc', 'ellipse'].includes(e.type)))
    return fail('Nonuniform fitting of circles, arcs or ellipses is not supported. Use preserveAspect:true.');
  const pointIds = new Set(before.entities.filter(e => selected.has(e.id)).flatMap(entityPointIds));
  for (const e of before.entities)
    if (
      e.type === 'line' &&
      ((e.owner && selected.has(e.owner.splineId)) || (e.construction && pointIds.has(e.startId) && pointIds.has(e.endId)))
    )
      selected.add(e.id);
  for (const e of before.entities)
    if (
      e.type !== 'point' &&
      !selected.has(e.id) &&
      entityPointIds(e).some(id => pointIds.has(id) && !before.entities.some(p => p.id === id && p.type === 'point' && p.fixed))
    )
      return fail('The fitted curves share editable points with unselected geometry. Include all connected curves.');
  const fixed = before.entities.filter((e): e is CadPointEntity => e.type === 'point' && pointIds.has(e.id) && !!e.fixed);
  if (fixed.some(p => p.id !== `${before.id}:origin`)) return fail('Fixed source points cannot be fitted. Remove their fixed state first.');
  const origin = fixed[0],
    ownOrigin = origin && { ...origin, id: newCadId(), fixed: false };
  const swap = (id: string) => (ownOrigin && id === origin!.id ? ownOrigin.id : id);
  const swapEntity = (e: CadEntity): CadEntity => {
    if (!selected.has(e.id)) return e;
    if (e.type === 'line') return { ...e, startId: swap(e.startId), endId: swap(e.endId) };
    if (e.type === 'circle') return { ...e, centerId: swap(e.centerId) };
    if (e.type === 'arc') return { ...e, centerId: swap(e.centerId), startId: swap(e.startId), endId: swap(e.endId) };
    if (e.type === 'bezier' || e.type === 'spline')
      return {
        ...e,
        startId: swap(e.startId),
        endId: swap(e.endId),
        controlPointIds: e.controlPointIds.map(swap),
        ...(e.type === 'spline' && { fitPointIds: e.fitPointIds.map(swap) }),
      };
    if (e.type === 'conic') return { ...e, startId: swap(e.startId), endId: swap(e.endId), controlId: swap(e.controlId) };
    return e;
  };
  const transformed = new Set([...pointIds].map(swap));
  const scaleExpression = (axis: 0 | 1): string | undefined => {
    if (typeof options.w === 'number' && typeof options.h === 'number') return undefined;
    return options.preserveAspect
      ? `min(${lengthExpression(options.w)}/${source.size[0]}mm;${lengthExpression(options.h)}/${source.size[1]}mm)`
      : `${lengthExpression(axis === 0 ? options.w : options.h)}/${source.size[axis]}mm`;
  };
  const scaled = (value: number, axis: 0 | 1): Len => {
    const expression = scaleExpression(axis);
    return expression ? `${value}mm*(${expression})` : value * scales[axis];
  };
  const coordinate = (value: number, axis: 0 | 1): Len => {
    const delta = scaled(value - source.at[axis], axis);
    return typeof delta === 'number' && typeof at[axis] === 'number'
      ? at[axis] + delta
      : `${lengthExpression(at[axis]!)} + ${lengthExpression(delta)}`;
  };
  const replacedExpressions: string[] = [];
  const activeConstraints = before.constraints.filter(c => constraintEntityIds(c).some(id => selected.has(id) || pointIds.has(id)));
  for (const c of activeConstraints) {
    const references = constraintEntityIds(c),
      external = references.filter(id => !selected.has(id) && !pointIds.has(id));
    const fixedReference =
      c.type === 'angle' &&
      external.every(id => {
        const e = before.entities.find(e => e.id === id);
        return (
          e?.type === 'line' &&
          e.construction &&
          entityPointIds(e).every(id => before.entities.some(p => p.id === id && p.type === 'point' && p.fixed))
        );
      });
    if (external.length && !fixedReference)
      return fail('A fitted dimension or relation refers to unselected geometry. Include its geometry or remove the relation first.');
    if (c.type === 'linearPattern' || c.type === 'circularPattern' || c.type === 'slot')
      return fail('Fit the source curves before creating patterns or slots.');
    if (!uniform && ['angle', 'distance', 'radius', 'diameter', 'offset', 'equal', 'perpendicular'].includes(c.type))
      return fail('This relation cannot be preserved by nonuniform fitting. Use preserveAspect:true.');
  }
  const convertConstraint = (c: CadConstraint): CadConstraint => {
    if (!activeConstraints.includes(c)) return c;
    let next = Object.fromEntries(
      Object.entries(c).map(([key, value]) => [
        key,
        typeof value === 'string' && ['pointId', 'pointAId', 'pointBId'].includes(key) ? swap(value) : value,
      ])
    ) as CadConstraint;
    if (!('value' in c) || c.type === 'angle') return next;
    const axis = c.type === 'positionY' || c.type === 'distanceY' ? 1 : 0;
    const expression = c.type === 'positionX' || c.type === 'positionY' ? coordinate(c.value, axis) : scaled(c.value, axis);
    if (c.expression) replacedExpressions.push(c.expression);
    const { expression: _old, ...plain } = next as typeof c;
    next = {
      ...plain,
      label: `Fit ${c.type}`,
      value: measure(expression, 'Fitted dimension'),
      ...(typeof expression === 'string' && { expression }),
    } as CadConstraint;
    return next;
  };
  let sketch: CadSketch = {
    ...before,
    entities: [...before.entities.map(swapEntity), ...(ownOrigin ? [ownOrigin] : [])].map(e =>
      e.type === 'point' && transformed.has(e.id)
        ? { ...e, x: measure(coordinate(e.x, 0), 'Fitted X'), y: measure(coordinate(e.y, 1), 'Fitted Y') }
        : selected.has(e.id) && (e.type === 'circle' || e.type === 'arc' || e.type === 'ellipse')
          ? { ...e, radius: e.radius * scalar }
          : e
    ),
    constraints: before.constraints.map(convertConstraint),
  };
  // The immutable origin can be replaced by an editable shared endpoint without moving the sketch's coordinate frame.
  if (ownOrigin)
    for (const axis of [0, 1] as const) {
      const expression = coordinate(origin![axis === 0 ? 'x' : 'y'], axis);
      sketch = addConstraint(sketch, {
        type: axis === 0 ? 'positionX' : 'positionY',
        pointId: ownOrigin.id,
        label: axis === 0 ? 'Fit X' : 'Fit Y',
        value: measure(expression, 'Fit origin'),
        ...(typeof expression === 'string' && { expression }),
      });
    }
  // An arc ties both ends to one circle, so one end keeps a single driver: the coordinate that moves most along the arc there.
  const usedPoint = (id: string) => id === origin?.id || activeConstraints.some(c => constraintEntityIds(c).includes(id));
  const ownersOf = (id: string) => before.entities.filter(e => selected.has(e.id) && entityPointIds(e).includes(id));
  const pointOf = (id: string) => before.entities.find(e => e.id === id) as CadPointEntity;
  const singleAxis = new Map<string, 0 | 1>(),
    undriven = new Set<string>();
  for (const arc of before.entities) {
    if (arc.type !== 'arc' || !selected.has(arc.id)) continue;
    const end = [arc.endId, arc.startId].find(
      id => !singleAxis.has(id) && !usedPoint(id) && ownersOf(id).every(e => e === arc || e.type === 'line')
    );
    if (end === undefined) {
      if ([options.w, options.h, ...at].some(value => typeof value !== 'number'))
        return fail('This arc shares both ends with other curves, so an expression fit cannot keep driving it. Fit with numeric values.');
      entityPointIds(arc).forEach(id => undriven.add(id));
      continue;
    }
    const center = pointOf(arc.centerId),
      p = pointOf(end);
    singleAxis.set(end, Math.abs(p.y - center.y) >= Math.abs(p.x - center.x) ? 0 : 1);
  }
  for (const id of transformed) {
    const originally = id === ownOrigin?.id ? origin!.id : id;
    const owners = ownersOf(originally);
    if (
      usedPoint(originally) ||
      undriven.has(originally) ||
      owners.some(e => !['line', 'bezier', 'conic', 'circle', 'arc'].includes(e.type))
    )
      continue;
    const p = pointOf(originally);
    for (const axis of singleAxis.has(originally) ? [singleAxis.get(originally)!] : ([0, 1] as const)) {
      const expression = coordinate(p[axis === 0 ? 'x' : 'y'], axis);
      sketch = addConstraint(sketch, {
        type: axis === 0 ? 'positionX' : 'positionY',
        pointId: id,
        label: axis === 0 ? 'Fit X' : 'Fit Y',
        value: measure(expression, 'Fitted point'),
        ...(typeof expression === 'string' && { expression }),
      });
    }
  }
  for (const e of before.entities) {
    if (e.type !== 'circle' || !selected.has(e.id)) continue;
    if (activeConstraints.some(c => (c.type === 'radius' || c.type === 'diameter') && c.entityId === e.id)) continue;
    const expression = scaled(e.radius, 0);
    sketch = addConstraint(sketch, {
      type: 'radius',
      entityId: e.id,
      label: 'Fit radius',
      value: measure(expression, 'Fitted radius'),
      ...(typeof expression === 'string' && { expression }),
    });
  }
  apply(() => sketch);
  return {
    source,
    fitted: { at: [measure(at[0], 'Fit X'), measure(at[1], 'Fit Y')], size: [source.size[0] * scales[0], source.size[1] * scales[1]] },
    scale: scales,
    preserveAspect: options.preserveAspect,
    replacedExpressions: [...new Set(replacedExpressions)],
  };
}
