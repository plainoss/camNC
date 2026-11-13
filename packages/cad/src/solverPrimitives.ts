// Translates CAD sketch geometry and constraints into PlaneGCS primitives, and reads the solved values back. Split out of solver.ts.
import type { GcsWrapper, SketchPrimitive } from '@salusoft89/planegcs';
import { slotPrimitives } from './slotConstraint';
import { CAD_GEOMETRY_TOLERANCE } from './geometry';
import type { CadArcEntity, CadConstraint, CadEntity, CadLineEntity, CadNurbsEntity, CadPart, CadPointEntity } from './types';
import {
  closestCurvePoint,
  curveEndpointIds,
  evaluateCurvePoint,
  evaluateCurveTangent,
  isNurbsCurve,
  rationalCurveData,
  splineNativePoleIds,
} from './curves';
import type { CadPointEquivalence } from './pointEquivalence';
import { offsetNativePrimitives } from './offsetConstraint';
import { curveSymmetryPrimitives } from './symmetry';
import { linearPatternPrimitives } from './patternConstraint';

/** PlaneGCS normalizes symmetry's perpendicular equation by the initial point separation.
 * An on-axis mirror has zero separation. Condition registration only, then restore
 * the exact source/copy guess before solving; no coordinates or fixed flags persist. */
export function pushConditionedPrimitive(wrapper: GcsWrapper, primitive: SketchPrimitive): void {
  if (primitive.type !== 'p2p_symmetric_ppl') {
    wrapper.push_primitive(primitive);
    return;
  }
  const ai = wrapper.p_param_index.get(primitive.p1_id),
    bi = wrapper.p_param_index.get(primitive.p2_id);
  const axis = wrapper.sketch_index.get_primitive(primitive.l_id);
  if (ai === undefined || bi === undefined || axis?.type !== 'line') throw new Error('Missing native symmetry geometry.');
  if (ai === bi) {
    wrapper.push_primitive({ id: primitive.id, type: 'point_on_line_pl', p_id: primitive.p1_id, l_id: primitive.l_id });
    return;
  }
  const ax = wrapper.gcs.get_p_param(ai),
    ay = wrapper.gcs.get_p_param(ai + 1);
  const bx = wrapper.gcs.get_p_param(bi),
    by = wrapper.gcs.get_p_param(bi + 1);
  if (Math.hypot(bx - ax, by - ay) > CAD_GEOMETRY_TOLERANCE) {
    wrapper.push_primitive(primitive);
    return;
  }
  const start = wrapper.p_param_index.get(axis.p1_id)!,
    end = wrapper.p_param_index.get(axis.p2_id)!;
  const dx = wrapper.gcs.get_p_param(end) - wrapper.gcs.get_p_param(start);
  const dy = wrapper.gcs.get_p_param(end + 1) - wrapper.gcs.get_p_param(start + 1),
    length = Math.hypot(dx, dy);
  if (!length) throw new Error('A symmetry axis needs distinct endpoints.');
  const fixedX = wrapper.gcs.get_is_fixed(bi),
    fixedY = wrapper.gcs.get_is_fixed(bi + 1);
  try {
    wrapper.gcs.set_p_param(bi, ax - dy / length, fixedX);
    wrapper.gcs.set_p_param(bi + 1, ay + dx / length, fixedY);
    wrapper.push_primitive(primitive);
  } finally {
    wrapper.gcs.set_p_param(bi, bx, fixedX);
    wrapper.gcs.set_p_param(bi + 1, by, fixedY);
  }
}

export function nativeCurveData(e: Exclude<CadNurbsEntity, { type: 'ellipse' }>, points: Map<string, CadPointEntity>) {
  const data = rationalCurveData(e, points),
    lo = data.knots[data.degree]!,
    hi = data.knots[data.poles.length]!;
  const poleIds = e.type === 'conic' ? [e.startId, e.controlId, e.endId] : e.type === 'spline' ? splineNativePoleIds(e) : e.controlPointIds;
  const periodic = e.type === 'spline' && !!e.closed;
  const full = periodic ? data.knots.filter(k => k >= lo && k <= hi) : data.knots,
    knots = [...new Set(full)];
  const weights = e.type === 'spline' && e.closed ? poleIds.map(id => e.weights[e.controlPointIds.indexOf(id)]!) : data.weights;
  return { poleIds, weights, knots, mult: knots.map(k => full.filter(value => value === k).length), degree: data.degree, periodic };
}
export function solverGeometry(e: CadEntity, points: Map<string, CadPointEntity>): SketchPrimitive {
  switch (e.type) {
    case 'point':
      return { id: e.id, type: 'point', x: e.x, y: e.y, fixed: e.fixed ?? false };
    case 'line':
      return { id: e.id, type: 'line', p1_id: e.startId, p2_id: e.endId };
    case 'ellipse':
      return { id: e.id, type: 'ellipse', c_id: e.centerId, focus1_id: e.focusId, radmin: e.radius };
    case 'circle':
      return { id: e.id, type: 'circle', c_id: e.centerId, radius: e.radius };
    case 'arc':
      return {
        id: e.id,
        type: 'arc',
        c_id: e.centerId,
        start_id: e.startId,
        end_id: e.endId,
        radius: e.radius,
        start_angle: e.startAngle,
        end_angle: e.endAngle,
      };
    case 'conic':
    case 'bezier':
    case 'spline': {
      const { poleIds, ...data } = nativeCurveData(e, points);
      return { id: e.id, type: 'bspline', pole_ids: poleIds, ...data };
    }
  }
}

export function solverConstraint(
  c: CadConstraint,
  entities: Map<string, CadEntity>,
  coincident: CadPointEquivalence,
  constraints: readonly CadConstraint[],
  offsetSeed: ReadonlyMap<string, CadEntity>
): SketchPrimitive | SketchPrimitive[] {
  const id = c.id;
  switch (c.type) {
    case 'slot':
      return slotPrimitives(c, entities, constraints);
    case 'circularPattern':
    case 'linearPattern':
      return linearPatternPrimitives(c, entities);
    case 'symmetricCurves':
      return curveSymmetryPrimitives(c, entities);
    case 'regularPolygon':
      if (c.mode === 'circumscribed') {
        const circle = entities.get(c.circleId) as import('./types').CadCircleEntity;
        return c.edgeIds.flatMap((edgeId, index): SketchPrimitive[] => [
          { id: `${id}:spoke:${index}`, type: 'line', p1_id: circle.centerId, p2_id: (entities.get(edgeId) as CadLineEntity).startId },
          { id: `${id}:vertex:${index}`, type: 'point_on_circle', p_id: (entities.get(edgeId) as CadLineEntity).startId, c_id: circle.id },
          ...(index > 0
            ? [
                {
                  id: `${id}:turn:${index}`,
                  type: 'l2l_angle_ll' as const,
                  l1_id: `${id}:spoke:${index - 1}`,
                  l2_id: `${id}:spoke:${index}`,
                  angle: (2 * Math.PI) / c.edgeIds.length,
                },
              ]
            : []),
        ]);
      }
      return c.edgeIds.flatMap((edgeId, index): SketchPrimitive[] => [
        { id: `${id}:side:${index}`, type: 'tangent_lc', l_id: edgeId, c_id: c.circleId },
        ...(index < c.edgeIds.length - 1
          ? [
              {
                id: `${id}:turn:${index}`,
                type: 'l2l_angle_ll' as const,
                l1_id: edgeId,
                l2_id: c.edgeIds[index + 1]!,
                angle: (2 * Math.PI) / c.edgeIds.length,
              },
            ]
          : []),
      ]);
    case 'offset':
      return offsetNativePrimitives(c, offsetSeed, constraints);
    case 'symmetricPoints':
      return { id, type: 'p2p_symmetric_ppl', p1_id: c.pointAId, p2_id: c.pointBId, l_id: c.lineId };
    case 'horizontal':
      return { id, type: 'horizontal_l', l_id: c.entityId };
    case 'vertical':
      return { id, type: 'vertical_l', l_id: c.entityId };
    case 'horizontalPoints':
      return { id, type: 'horizontal_pp', p1_id: c.pointAId, p2_id: c.pointBId };
    case 'verticalPoints':
      return { id, type: 'vertical_pp', p1_id: c.pointAId, p2_id: c.pointBId };
    case 'coincident':
      return { id, type: 'p2p_coincident', p1_id: c.pointAId, p2_id: c.pointBId };
    case 'pointOnLine':
      return { id, type: 'point_on_line_pl', p_id: c.pointId, l_id: c.entityId };
    case 'pointOnCircle':
      return entities.get(c.entityId)?.type === 'arc'
        ? { id, type: 'point_on_arc', p_id: c.pointId, a_id: c.entityId }
        : { id, type: 'point_on_circle', p_id: c.pointId, c_id: c.entityId };
    case 'pointOnCurve': {
      const curve = entities.get(c.entityId) as CadNurbsEntity;
      if (curve.type === 'ellipse') return { id, type: 'point_on_ellipse', p_id: c.pointId, e_id: curve.id };
      const points = new Map([...entities].filter((entry): entry is [string, CadPointEntity] => entry[1].type === 'point'));
      const data = rationalCurveData(curve, points),
        lo = data.knots[data.degree]!,
        hi = data.knots[data.poles.length]!;
      return {
        id,
        type: 'point_on_bspline',
        p_id: c.pointId,
        b_id: c.entityId,
        pointparam: c.parameterFixed ? lo + c.parameter * (hi - lo) : `${c.id}:parameter`,
      };
    }
    case 'midpoint': {
      const line = entities.get(c.entityId)!;
      if (line.type !== 'line') throw new Error('Midpoint requires a line.');
      return { id, type: 'p2p_symmetric_ppp', p1_id: line.startId, p2_id: line.endId, p_id: c.pointId };
    }
    case 'pointArcDistance':
    case 'lineCircleDistance': {
      const circular = entities.get(c.type === 'pointArcDistance' ? c.entityId : c.entityBId) as
        | import('./types').CadCircleEntity
        | CadArcEntity;
      const distance = `${id}:center-distance`;
      return [
        c.type === 'pointArcDistance'
          ? { id, type: 'p2p_distance', p1_id: circular.centerId, p2_id: c.pointId, distance }
          : { id, type: 'p2l_distance', p_id: circular.centerId, l_id: c.entityAId, distance },
        c.radiusSide === 'far'
          ? {
              id: `${id}:radius-gap`,
              type: 'difference',
              param1: distance,
              param2: c.value,
              difference: { o_id: circular.id, prop: 'radius' },
            }
          : {
              id: `${id}:radius-gap`,
              type: 'difference',
              param1: { o_id: circular.id, prop: 'radius' },
              param2: distance,
              difference: c.side === 'outside' ? c.value : -c.value,
            },
      ];
    }
    case 'circleCircleDistance': {
      const a = entities.get(c.entityAId) as import('./types').CadCircleEntity | CadArcEntity;
      const b = entities.get(c.entityBId) as import('./types').CadCircleEntity | CadArcEntity;
      // Shared (including explicitly coincident) centers have no separation parameter.
      // A zero-length p2p equation has a singular Jacobian and hides the radius-gap rank.
      const concentric = coincident.equivalent(a.centerId, b.centerId);
      const distance = concentric ? 0 : `${id}:center-distance`,
        intermediate = `${id}:radius-distance`;
      const ra = { o_id: a.id, prop: 'radius' as const },
        rb = { o_id: b.id, prop: 'radius' as const };
      return [
        ...(!concentric ? [{ id, type: 'p2p_distance' as const, p1_id: a.centerId, p2_id: b.centerId, distance }] : []),
        c.radiusASign === 1
          ? { id: `${id}:radius-a`, type: 'difference', param1: distance, param2: intermediate, difference: ra }
          : { id: `${id}:radius-a`, type: 'difference', param1: ra, param2: distance, difference: intermediate },
        c.radiusBSign === 1
          ? { id: `${id}:radius-b`, type: 'difference', param1: intermediate, param2: c.direction * c.value, difference: rb }
          : { id: `${id}:radius-b`, type: 'difference', param1: rb, param2: intermediate, difference: c.direction * c.value },
      ];
    }
    case 'pointLineDistance':
      return c.value === 0
        ? { id, type: 'point_on_line_pl', p_id: c.pointId, l_id: c.entityId }
        : { id, type: 'p2l_distance', p_id: c.pointId, l_id: c.entityId, distance: c.value };
    case 'lineLineDistance': {
      const second = entities.get(c.entityBId) as CadLineEntity;
      return [
        { id: `${id}:parallel`, type: 'parallel', l1_id: c.entityAId, l2_id: c.entityBId },
        c.value === 0
          ? { id, type: 'point_on_line_pl', p_id: second.startId, l_id: c.entityAId }
          : { id, type: 'p2l_distance', p_id: second.startId, l_id: c.entityAId, distance: c.value },
      ];
    }
    case 'distance':
      return { id, type: 'p2p_distance', p1_id: c.pointAId, p2_id: c.pointBId, distance: c.value };
    // PlaneGCS Difference is param2 - param1 = difference, verified against the published WASM.
    case 'distanceX':
    case 'distanceY':
      return {
        id,
        type: 'difference',
        param1: { o_id: c.pointAId, prop: c.type === 'distanceX' ? 'x' : 'y' },
        param2: { o_id: c.pointBId, prop: c.type === 'distanceX' ? 'x' : 'y' },
        difference: c.value,
      };
    case 'positionX':
      return { id, type: 'coordinate_x', p_id: c.pointId, x: c.value };
    case 'positionY':
      return { id, type: 'coordinate_y', p_id: c.pointId, y: c.value };
    case 'radius':
      return entities.get(c.entityId)?.type === 'arc'
        ? { id, type: 'arc_radius', a_id: c.entityId, radius: c.value }
        : { id, type: 'circle_radius', c_id: c.entityId, radius: c.value };
    case 'diameter':
      return entities.get(c.entityId)?.type === 'arc'
        ? { id, type: 'arc_diameter', a_id: c.entityId, diameter: c.value }
        : { id, type: 'circle_diameter', c_id: c.entityId, diameter: c.value };
    case 'parallel':
      return { id, type: 'parallel', l1_id: c.entityAId, l2_id: c.entityBId };
    case 'perpendicular':
      return { id, type: 'perpendicular_ll', l1_id: c.entityAId, l2_id: c.entityBId };
    case 'angle':
      return {
        id,
        type: 'l2l_angle_ll',
        l1_id: c.entityAId,
        l2_id: c.entityBId,
        angle:
          ((c.orientation === undefined ? c.value : c.orientation * c.value + (c.reversedA ? 180 : 0) - (c.reversedB ? 180 : 0)) *
            Math.PI) /
          180,
      };
    case 'equal': {
      const a = entities.get(c.entityAId)!,
        b = entities.get(c.entityBId)!;
      if (a.type === 'line' && b.type === 'line') return { id, type: 'equal_length', l1_id: a.id, l2_id: b.id };
      if (a.type === 'circle' && b.type === 'circle') return { id, type: 'equal_radius_cc', c1_id: a.id, c2_id: b.id };
      if (a.type === 'arc' && b.type === 'arc') return { id, type: 'equal_radius_aa', a1_id: a.id, a2_id: b.id };
      return { id, type: 'equal_radius_ca', c1_id: a.type === 'circle' ? a.id : b.id, a2_id: a.type === 'arc' ? a.id : b.id };
    }
    case 'tangent': {
      let a = entities.get(c.entityAId)!,
        b = entities.get(c.entityBId)!;
      if (isNurbsCurve(a) || isNurbsCurve(b)) {
        if (!isNurbsCurve(a)) [a, b] = [b, a];
        const shared = coincident.match(curveEndpointIds(a), curveEndpointIds(b))!;
        const points = new Map([...entities].filter((entry): entry is [string, CadPointEntity] => entry[1].type === 'point'));
        const parameter = (curve: CadEntity) => (coincident.equivalent(curveEndpointIds(curve)[0]!, shared[0]) ? 0 : 1);
        const ta = evaluateCurveTangent(a as Exclude<CadEntity, { type: 'point' }>, points, parameter(a));
        const tb = evaluateCurveTangent(b as Exclude<CadEntity, { type: 'point' }>, points, parameter(b));
        const angle = ta.x * tb.x + ta.y * tb.y >= 0 ? 0 : Math.PI;
        // At clamped endpoints the native BSpline normal uses its adjacent poles directly.
        return { id, type: 'angle_via_point', crv1_id: a.id, crv2_id: b.id, p_id: coincident.canonical(shared[0]), angle };
      }
      if ((a.type === 'line' || a.type === 'arc') && (b.type === 'line' || b.type === 'arc')) {
        const curveA = a,
          curveB = b;
        const group = coincident.canonical;
        const sharedId = [curveA.startId, curveA.endId].find(pointId =>
          [curveB.startId, curveB.endId].some(otherId => group(pointId) === group(otherId))
        );
        if (sharedId) {
          const point = entities.get(sharedId) as CadPointEntity;
          const normal = (curve: CadLineEntity | CadArcEntity): [number, number] => {
            if (curve.type === 'line') {
              const start = entities.get(curve.startId) as CadPointEntity;
              const end = entities.get(curve.endId) as CadPointEntity;
              return [start.y - end.y, end.x - start.x];
            }
            const center = entities.get(curve.centerId) as CadPointEntity;
            return [center.x - point.x, center.y - point.y];
          };
          const [ax, ay] = normal(curveA),
            [bx, by] = normal(curveB);
          // The distance-to-circle tangent equation loses first-order rank at a shared endpoint.
          // A native angle between curve normals retains the joined tangent's independent equation.
          return {
            id,
            type: 'angle_via_point',
            crv1_id: curveA.id,
            crv2_id: curveB.id,
            p_id: sharedId,
            angle: ax * bx + ay * by >= 0 ? 0 : Math.PI,
          };
        }
      }
      if (b.type === 'line' || (a.type === 'arc' && b.type === 'circle')) [a, b] = [b, a];
      if (a.type === 'line' && b.type === 'circle') return { id, type: 'tangent_lc', l_id: a.id, c_id: b.id };
      if (a.type === 'line' && b.type === 'arc') return { id, type: 'tangent_la', l_id: a.id, a_id: b.id };
      if (a.type === 'circle' && b.type === 'circle') return { id, type: 'tangent_cc', c1_id: a.id, c2_id: b.id };
      if (a.type === 'arc' && b.type === 'arc') return { id, type: 'tangent_aa', a1_id: a.id, a2_id: b.id };
      return { id, type: 'tangent_ca', c_id: a.id, a_id: b.id };
    }
  }
}

export function applySolvedGeometry(part: CadPart, wrapper: GcsWrapper): void {
  wrapper.apply_solution();
  for (const entity of part.sketch.entities) {
    const solved = wrapper.sketch_index.get_primitive(entity.id);
    if (entity.type === 'point' && solved?.type === 'point') {
      entity.x = solved.x;
      entity.y = solved.y;
    } else if (entity.type === 'ellipse' && solved?.type === 'ellipse') {
      entity.radius = solved.radmin;
    } else if ((entity.type === 'circle' || entity.type === 'arc') && (solved?.type === 'circle' || solved?.type === 'arc')) {
      entity.radius = solved.radius;
      if (entity.type === 'arc' && solved.type === 'arc') {
        entity.startAngle = solved.start_angle;
        entity.endAngle = solved.end_angle;
      }
    }
  }
  const points = new Map(part.sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(e => [e.id, e]));
  for (const constraint of part.sketch.constraints)
    if (constraint.type === 'pointOnCurve' && !constraint.parameterFixed) {
      const curve = part.sketch.entities.find(e => e.id === constraint.entityId) as CadNurbsEntity;
      if (curve.type === 'ellipse') {
        constraint.parameter = closestCurvePoint(curve, points, points.get(constraint.pointId)!).parameter;
        continue;
      }
      const data = rationalCurveData(curve, points),
        lo = data.knots[data.degree]!,
        hi = data.knots[data.poles.length]!;
      const solved = wrapper.get_sketch_param_value(`${constraint.id}:parameter`);
      if (solved === undefined) throw new Error('The curve contact parameter was not solved.');
      constraint.parameter = (solved - lo) / (hi - lo);
    }
}
/** Never publish native success unless its evaluated curve equations match retained source. */
export function solvedCurveEquationsHold(part: CadPart): boolean {
  const entities = new Map(part.sketch.entities.map(e => [e.id, e]));
  const points = new Map(part.sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(e => [e.id, e]));
  const matches = (curve: CadNurbsEntity, id: string, t: number) => {
    const actual = points.get(id)!,
      expected = evaluateCurvePoint(curve, points, t);
    return Math.hypot(actual.x - expected.x, actual.y - expected.y) <= CAD_GEOMETRY_TOLERANCE;
  };
  for (const curve of part.sketch.entities) {
    if (curve.type === 'ellipse') {
      const diameter = (a: string, b: string, t: number) =>
        (matches(curve, a, t) && matches(curve, b, t + 0.5)) || (matches(curve, b, t) && matches(curve, a, t + 0.5));
      if (!diameter(curve.majorStartId, curve.majorEndId, 0) || !diameter(curve.minorStartId, curve.minorEndId, 0.25)) return false;
    }
    if (curve.type === 'spline' && !curve.fitPointIds.every((id, i) => matches(curve, id, curve.fitParameters[i]!))) return false;
  }
  for (const c of part.sketch.constraints)
    if (c.type === 'pointOnCurve' && !matches(entities.get(c.entityId) as CadNurbsEntity, c.pointId, c.parameter)) return false;
  return true;
}
