import {
  addBezier,
  addSpline,
  addEllipse,
  addConstraint,
  newCadId,
  offsetSketch,
  type CadSketch,
  type CadPointEntity,
  type CadEntity,
  type CadValueUnit,
} from '@wbcnc/cad';
import { fail } from './editExisting';
import { lengthExpression, splineHandleCoordinates } from './curveExpressions';
import type { CadRef, Len, LenXy, SketchEdit } from './editTypes';

export interface SketchCurveContext {
  current(): CadSketch;
  apply(edit: (sketch: CadSketch) => CadSketch): void;
  measure(value: Len, label: string, unit?: CadValueUnit): number;
  place(point: CadRef, at: LenXy): void;
}
export function createSketchCurves(context: SketchCurveContext) {
  const { current, apply, measure, place } = context;
  const constrain = (constraint: Parameters<typeof addConstraint>[1]) => apply(sketch => addConstraint(sketch, constraint));
  const xy = (point: LenXy) => ({ x: measure(point[0], 'X'), y: measure(point[1], 'Y') });
  const positioned = (id: string) =>
    current().constraints.some(c => (c.type === 'positionX' || c.type === 'positionY') && c.pointId === id);
  const locate = (id: string, at: LenXy, ownerIds: readonly string[]) => {
    const point = current().entities.find(e => e.id === id) as CadPointEntity;
    if (point.fixed) {
      if (at.every(value => typeof value === 'number')) return id;
      // A dynamic coordinate coinciding with the immutable sketch origin needs its own editable point.
      const own = { ...point, id: newCadId(), fixed: false };
      const swap = (e: CadEntity): CadEntity => {
        if (!ownerIds.includes(e.id)) return e;
        if (e.type === 'bezier' || e.type === 'spline')
          return {
            ...e,
            startId: e.startId === id ? own.id : e.startId,
            endId: e.endId === id ? own.id : e.endId,
            controlPointIds: e.controlPointIds.map(p => (p === id ? own.id : p)),
            ...(e.type === 'spline' && { fitPointIds: e.fitPointIds.map(p => (p === id ? own.id : p)) }),
          };
        if (e.type === 'line') return { ...e, startId: e.startId === id ? own.id : e.startId, endId: e.endId === id ? own.id : e.endId };
        return e;
      };
      apply(sketch => ({ ...sketch, entities: [...sketch.entities.map(swap), own] }));
      id = own.id;
    }
    if (!positioned(id)) place({ id }, at);
    return id;
  };
  const bezier = (options: Parameters<SketchEdit['bezier']>[0], endpoints = true) => {
    try {
      apply(sketch => addBezier(sketch, { points: options.points.map(xy) }));
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Cannot create this Bézier curve.');
    }
    let curve = current().entities.at(-1)!;
    if (curve.type !== 'bezier') return fail('The Bézier curve was not created.');
    const id = curve.id;
    const count = curve.controlPointIds.length;
    for (let i = 0; i < count; i++) {
      const updated = current().entities.find(e => e.id === id)!;
      if (updated.type === 'bezier' && (endpoints || (i > 0 && i < count - 1)))
        locate(updated.controlPointIds[i]!, options.points[i]!, [id]);
    }
    curve = current().entities.find(e => e.id === id)!;
    if (curve.type !== 'bezier') return fail('The Bézier curve is missing.');
    return { id, start: { id: curve.startId }, end: { id: curve.endId }, controls: curve.controlPointIds.map(id => ({ id })) };
  };
  const spline: SketchEdit['spline'] = options => {
    try {
      apply(sketch => addSpline(sketch, { points: options.points.map(xy), closed: options.closed }));
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Cannot create this fit spline.');
    }
    const added = current().entities.at(-1)!;
    if (added.type !== 'spline') return fail('The fit spline was not created.');
    const sourceFits = options.points.slice(0, added.fitPointIds.length);
    const points = new Map(
      current()
        .entities.filter((e): e is CadPointEntity => e.type === 'point')
        .map(p => [p.id, p])
    );
    const handles = splineHandleCoordinates(added, points, sourceFits);
    const owners = [
      added.id,
      ...current()
        .entities.filter(e => e.type === 'line' && e.owner?.splineId === added.id)
        .map(e => e.id),
    ];
    added.fitPointIds.forEach((point, i) => locate(point, sourceFits[i]!, owners));
    if (!added.closed) [added.controlPointIds[1]!, added.controlPointIds.at(-2)!].forEach((id, i) => locate(id, handles[i]!, owners));
    const curve = current().entities.find(e => e.id === added.id)!;
    if (curve.type !== 'spline') return fail('The fit spline is missing.');
    return {
      id: curve.id,
      start: { id: curve.startId },
      end: { id: curve.endId },
      controls: curve.controlPointIds.map(id => ({ id })),
      fitPoints: curve.fitPointIds.map(id => ({ id })),
    };
  };
  const ellipse: SketchEdit['ellipse'] = ({ at, rx, ry, angle = 0 }) => {
    const center = xy(at),
      x = measure(rx, 'Ellipse X radius'),
      y = measure(ry, 'Ellipse Y radius'),
      degrees = measure(angle, 'Ellipse angle', 'deg');
    const radians = (degrees * Math.PI) / 180,
      cos = Math.cos(radians),
      sin = Math.sin(radians);
    if (!(x >= 0.1 && y >= 0.1)) return fail('Both ellipse radii must be at least 0.1 mm.');
    try {
      apply(sketch =>
        addEllipse(sketch, {
          center,
          axis: { x: center.x + x * cos, y: center.y + x * sin },
          through: { x: center.x - y * sin, y: center.y + y * cos },
        })
      );
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Cannot create this ellipse.');
    }
    const curve = current().entities.at(-1)!;
    if (curve.type !== 'ellipse') return fail('The ellipse was not created.');
    place({ id: curve.centerId }, at);
    const primary = curve.primaryAxis === 'major' ? [curve.majorStartId, curve.majorEndId] : [curve.minorStartId, curve.minorEndId];
    const secondary = curve.primaryAxis === 'major' ? [curve.minorStartId, curve.minorEndId] : [curve.majorStartId, curve.majorEndId];
    for (const [ids, value] of [
      [primary, rx],
      [secondary, ry],
    ] as const)
      constrain({
        type: 'distance',
        pointAId: ids[0]!,
        pointBId: ids[1]!,
        value: 2 * measure(value, 'Ellipse radius'),
        ...(typeof value === 'string' && { expression: `2*${lengthExpression(value)}` }),
      });
    // The baseline is ordinary fixed construction geometry. The ellipse's axis line reuses its native points.
    const baseStart = { id: newCadId(), type: 'point' as const, x: 0, y: 0, fixed: true, construction: true };
    const baseEnd = { ...baseStart, id: newCadId(), x: 1 };
    const baseline = { id: newCadId(), type: 'line' as const, startId: baseStart.id, endId: baseEnd.id, construction: true };
    const axis = { id: newCadId(), type: 'line' as const, startId: curve.centerId, endId: primary[0]!, construction: true };
    apply(sketch => ({ ...sketch, entities: [...sketch.entities, baseStart, baseEnd, baseline, axis] }));
    constrain({
      type: 'angle',
      entityAId: baseline.id,
      entityBId: axis.id,
      value: degrees,
      ...(typeof angle === 'string' && { expression: angle }),
    });
    return {
      id: curve.id,
      center: { id: curve.centerId },
      major: [curve.majorStartId, curve.majorEndId].map(id => ({ id })),
      minor: [curve.minorStartId, curve.minorEndId].map(id => ({ id })),
    };
  };
  const offset: SketchEdit['offset'] = (items, { distance, wholeLoop }) => {
    const ids = items.flatMap(item =>
      'edges' in item
        ? Array.isArray(item.edges)
          ? item.edges.map(edge => edge.id)
          : Object.values(item.edges).map(edge => edge.id)
        : [item.id]
    );
    const result = offsetSketch(current(), { entityIds: ids, value: measure(distance, 'Offset'), wholeLoop });
    if (!result.ok) return fail(result.message);
    apply(() => ({
      ...result.sketch,
      constraints: result.sketch.constraints.map(c =>
        c.id === result.dimensionId && typeof distance === 'string' ? { ...c, expression: distance } : c
      ),
    }));
    return { edges: result.entityIds.map(id => ({ id })), dimension: { id: result.dimensionId } };
  };
  return {
    bezier: (options: Parameters<SketchEdit['bezier']>[0]) => bezier(options),
    spline,
    ellipse,
    offset,
    pathBezier: (points: readonly LenXy[]) => bezier({ points }, false),
  };
}
