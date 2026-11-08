import { sketchPatternOwner } from './pattern';
import { constraintEntityIds, entityPointIds, newCadId, originId } from './document';
import {
  curveEndpointIds,
  evaluateCurvePoint,
  isNurbsCurve,
  rationalBezierSpans,
  rationalCurveData,
  type RationalCurveData,
} from './curves';
import { CAD_GEOMETRY_TOLERANCE } from './geometry';
import { pointEquivalence } from './pointEquivalence';
import { isOwnedSplineHandle, withSplineHandleSegments } from './splineHandles';
import type { CadConstraint, CadEntity, CadLineEntity, CadPoint, CadPointEntity, CadSketch, CadSplineEntity } from './types';

type Hull = [number, number, number][];
const tau = Math.PI * 2;
const wrap = (value: number) => ((value % 1) + 1) % 1;
const near = (a: CadPoint, b: CadPoint) => Math.hypot(a.x - b.x, a.y - b.y) <= CAD_GEOMETRY_TOLERANCE;
export const isClosedSketchCurve = (curve: CadEntity) =>
  curve.type === 'circle' || curve.type === 'ellipse' || (curve.type === 'spline' && !!curve.closed);
function subdivide(hull: Hull, t: number): [Hull, Hull] {
  let row = hull.map(p => [...p] as [number, number, number]);
  const left = [row[0]!],
    right = [row.at(-1)!];
  while (row.length > 1) {
    row = row.slice(0, -1).map((p, i) => p.map((value, axis) => value * (1 - t) + row[i + 1]![axis]! * t) as [number, number, number]);
    left.push(row[0]!);
    right.unshift(row.at(-1)!);
  }
  return [left, right];
}
/** Exact homogeneous restriction, retaining knot span lengths and a common weight scale at joins. */
export function rationalCurveInterval(data: RationalCurveData, from: number, to: number): RationalCurveData {
  const spans: { controls: Hull; start: number; end: number }[] = [];
  const source = rationalBezierSpans(data);
  for (const shift of [0, 1])
    for (const span of source) {
      const a = Math.max(from, span.start + shift),
        b = Math.min(to, span.end + shift);
      if (b <= a + 1e-12) continue;
      const lo = (a - span.start - shift) / (span.end - span.start);
      const hi = (b - span.start - shift) / (span.end - span.start);
      let controls = span.controls;
      if (lo > 0) controls = subdivide(controls, lo)[1];
      if (hi < 1) controls = subdivide(controls, (hi - lo) / (1 - lo))[0];
      spans.push({ controls, start: a, end: b });
    }
  if (!spans.length) throw new Error('Choose two distinct locations on the curve.');
  const hull = spans.flatMap((span, i) => (i ? span.controls.slice(1) : span.controls));
  const knots = [
    ...Array(data.degree + 1).fill(0),
    ...spans.slice(1).flatMap(span => Array(data.degree).fill((span.start - from) / (to - from))),
    ...Array(data.degree + 1).fill(1),
  ];
  return { degree: data.degree, poles: hull.map(p => ({ x: p[0] / p[2], y: p[1] / p[2] })), weights: hull.map(p => p[2]), knots };
}
export type CadSplitResult =
  | { ok: true; sketch: CadSketch; entityIds: string[]; releasedConstraintIds: string[]; releasedFixedPointIds: string[] }
  | { ok: false; message: string };

/** Keep every exact segment in one detached edit. Closed curves require two cuts before source mutation. */
export function splitSketchCurve(sketch: CadSketch, entityId: string, parameters: readonly number[]): CadSplitResult {
  const curve = sketch.entities.find(e => e.id === entityId);
  const fail = (message: string): CadSplitResult => ({ ok: false, message });
  if (sketchPatternOwner(sketch, entityId)) return fail('Remove the pattern relation before splitting its finite geometry.');
  if (!curve || curve.type === 'point' || isOwnedSplineHandle(curve))
    return fail('Select a sketch curve, away from its endpoints or tangent handles.');
  const closed = isClosedSketchCurve(curve);
  if (parameters.length !== (closed ? 2 : 1) || parameters.some(t => !Number.isFinite(t) || t < 0 || t > 1))
    return fail(closed ? 'Choose two distinct locations on this closed curve.' : 'Choose one interior location on this curve.');
  const cuts = [...parameters].map(t => (closed ? wrap(t) : t)).sort((a, b) => a - b);
  if (cuts.some(t => !closed && (t < 1e-8 || t > 1 - 1e-8)) || (closed && (cuts[1]! - cuts[0]! < 1e-8 || 1 - cuts[1]! + cuts[0]! < 1e-8)))
    return fail('Choose a location away from existing endpoints and the other split point.');
  const points = new Map(sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(e => [e.id, e]));
  const cutPoints = cuts.map(t => evaluateCurvePoint(curve, points, t));
  if (closed ? near(cutPoints[0]!, cutPoints[1]!) : curveEndpointIds(curve).some(id => near(points.get(id)!, cutPoints[0]!)))
    return fail('The split would create a segment smaller than the geometry tolerance.');
  const intervals: [number, number][] = closed
    ? [
        [cuts[0]!, cuts[1]!],
        [cuts[1]!, cuts[0]! + 1],
      ]
    : [
        [0, cuts[0]!],
        [cuts[0]!, 1],
      ];
  const next = structuredClone(sketch);
  const obsoleteHandles = new Set(sketch.entities.filter(e => isOwnedSplineHandle(e) && e.owner.splineId === curve.id).map(e => e.id));
  next.entities = next.entities.filter(e => e.id !== curve.id && !obsoleteHandles.has(e.id));
  const pieces: Exclude<CadEntity, { type: 'point' | 'circle' | 'ellipse' }>[] = [];
  const fullyFixed = curve.type !== 'circle' && entityPointIds(curve).every(id => points.get(id)?.fixed);
  const newPoint = (point: CadPoint, construction = curve.construction) => {
    const entity: CadPointEntity = {
      id: newCadId(),
      type: 'point',
      ...point,
      construction,
      standalone: false,
      fixed: fullyFixed || undefined,
    };
    next.entities.push(entity);
    return entity.id;
  };
  const outer = curveEndpointIds(curve);
  const rational = isNurbsCurve(curve) ? rationalCurveData(curve, points) : null;
  const claimedFitIds = new Set<string>();
  const cutEndpoint = (parameter: number) => {
    const index =
      curve.type === 'spline'
        ? curve.fitParameters.findIndex(
            (t, i) =>
              Math.abs(t - wrap(parameter)) < 1e-8 &&
              near(points.get(curve.fitPointIds[i]!)!, evaluateCurvePoint(curve, points, wrap(parameter)))
          )
        : -1;
    const fitId = curve.type === 'spline' && index >= 0 ? curve.fitPointIds[index] : undefined;
    if (fitId && !claimedFitIds.has(fitId)) {
      claimedFitIds.add(fitId);
      return fitId;
    }
    return newPoint(evaluateCurvePoint(curve, points, wrap(parameter)));
  };
  for (const [index, [from, to]] of intervals.entries()) {
    const startId = !closed && index === 0 ? outer[0]! : cutEndpoint(from);
    const endId = !closed && index === 1 ? outer[1]! : cutEndpoint(to);
    const id = index === 0 ? curve.id : newCadId();
    const base = { id, startId, endId, construction: curve.construction };
    if (curve.type === 'line') pieces.push({ ...base, type: 'line' });
    else if (curve.type === 'circle' || curve.type === 'arc') {
      const start = curve.type === 'arc' ? curve.startAngle : 0;
      const sweep = curve.type === 'arc' ? (((curve.endAngle - start) % tau) + tau) % tau || tau : tau;
      pieces.push({
        ...base,
        type: 'arc',
        centerId: curve.centerId,
        radius: curve.radius,
        startAngle: start + from * sweep,
        endAngle: start + to * sweep,
      });
    } else {
      const data = rationalCurveInterval(rational!, from, to);
      if (curve.type !== 'bezier' && data.poles.length > 384)
        return fail('This imported spline needs more poles than an editable split segment supports.');
      const ids = data.poles.map((point, i) => (i === 0 ? startId : i === data.poles.length - 1 ? endId : newPoint(point, true)));
      if (curve.type === 'bezier') pieces.push({ ...base, type: 'bezier', controlPointIds: ids });
      else {
        const fits: { id: string; t: number }[] = [
          { id: startId, t: 0 },
          { id: endId, t: 1 },
        ];
        if (curve.type === 'spline')
          curve.fitPointIds.forEach((fitId, i) => {
            let t = curve.fitParameters[i]!;
            if (closed && t < from) t += 1;
            if (fitId !== startId && fitId !== endId && t > from + 1e-12 && t < to - 1e-12)
              fits.push({ id: fitId, t: (t - from) / (to - from) });
          });
        if (fits.length > 66) return fail('This curve has too many fit points for an editable split segment.');
        fits.sort((a, b) => a.t - b.t);
        pieces.push({
          ...base,
          type: 'spline',
          controlPointIds: ids,
          fitPointIds: fits.map(f => f.id),
          fitParameters: fits.map(f => f.t),
          degree: data.degree,
          knots: data.knots,
          weights: data.weights,
        } as CadSplineEntity);
      }
    }
  }
  next.entities.push(...pieces);
  const join = (a: string, b: string) => next.constraints.push({ id: newCadId(), type: 'coincident', pointAId: a, pointBId: b });
  join(pieces[0]!.endId, pieces[1]!.startId);
  if (closed) join(pieces[1]!.endId, pieces[0]!.startId);
  if (curve.type === 'line')
    next.constraints.push({ id: newCadId(), type: 'parallel', entityAId: pieces[0]!.id, entityBId: pieces[1]!.id });
  // Arc endpoints and a shared center already couple the radii; an extra equal relation would be redundant.
  const equivalent = pointEquivalence(sketch.constraints);
  let wholeLine: CadLineEntity | undefined;
  const releasedConstraintIds: string[] = [];
  const release = (c: CadConstraint) => {
    releasedConstraintIds.push(c.id);
    return [];
  };
  const ownerAt = (t: number) =>
    intervals.findIndex(([a, b]) => {
      const u = closed && t < a ? t + 1 : t;
      return u >= a - 1e-8 && u <= b + 1e-8;
    });
  next.constraints = next.constraints.flatMap(c => {
    const refs = constraintEntityIds(c);
    if (refs.some(id => obsoleteHandles.has(id))) return release(c);
    if (!refs.includes(curve.id)) return [c];
    if (c.type === 'offset' || c.type === 'regularPolygon') return release(c);
    if (curve.type === 'line' && 'sourceEntityId' in c && c.sourceEntityId === curve.id) {
      wholeLine ??= { ...curve, id: newCadId(), construction: true };
      return [{ ...c, sourceEntityId: wholeLine.id }];
    }
    if (curve.type === 'line' && (c.type === 'equal' || c.type === 'midpoint')) {
      wholeLine ??= { ...curve, id: newCadId(), construction: true };
      return [
        {
          ...c,
          ...('entityId' in c
            ? { entityId: wholeLine.id }
            : {
                entityAId: c.entityAId === curve.id ? wholeLine.id : c.entityAId,
                entityBId: c.entityBId === curve.id ? wholeLine.id : c.entityBId,
              }),
        },
      ];
    }
    if (c.type === 'pointOnCurve') {
      const index = ownerAt(c.parameter);
      if (index < 0) return release(c);
      const [a, b] = intervals[index]!;
      const t = closed && c.parameter < a ? c.parameter + 1 : c.parameter;
      return [{ ...c, entityId: pieces[index]!.id, parameter: Math.max(0, Math.min(1, (t - a) / (b - a))) }];
    }
    if (c.type === 'tangent') {
      const other = sketch.entities.find(e => e.id === (c.entityAId === curve.id ? c.entityBId : c.entityAId));
      const joint = other && equivalent.match(curveEndpointIds(curve), curveEndpointIds(other));
      const piece = joint && pieces.find(e => curveEndpointIds(e).some(id => equivalent.equivalent(id, joint[0])));
      if (rational && !piece) return release(c);
      return piece
        ? [
            {
              ...c,
              entityAId: c.entityAId === curve.id ? piece.id : c.entityAId,
              entityBId: c.entityBId === curve.id ? piece.id : c.entityBId,
            },
          ]
        : [c];
    }
    if (
      rational &&
      [
        'radius',
        'diameter',
        'equal',
        'symmetricCurves',
        'pointOnCircle',
        'pointOnLine',
        'midpoint',
        'horizontal',
        'vertical',
        'parallel',
        'perpendicular',
        'angle',
        'pointArcDistance',
        'lineCircleDistance',
        'circleCircleDistance',
        'pointLineDistance',
        'lineLineDistance',
      ].includes(c.type)
    )
      return release(c);
    return [c];
  });
  if (wholeLine) next.entities.push(wholeLine);
  const used = new Set(next.entities.flatMap(entityPointIds));
  const old = new Set(entityPointIds(curve));
  const removed = new Set(
    next.entities
      .filter(e => e.type === 'point' && old.has(e.id) && !e.standalone && e.id !== originId(sketch) && !used.has(e.id))
      .map(e => e.id)
  );
  next.entities = next.entities.filter(e => !removed.has(e.id));
  next.constraints = next.constraints.flatMap(c => (constraintEntityIds(c).some(id => removed.has(id)) ? release(c) : [c]));
  const releasedFixedPointIds = fullyFixed ? [] : [...removed].filter(id => points.get(id)?.fixed);
  return {
    ok: true,
    sketch: withSplineHandleSegments(next),
    entityIds: pieces.map(e => e.id),
    releasedConstraintIds,
    releasedFixedPointIds,
  };
}
