import { constraintEntityIds, entityPointIds, type CadEntity, type CadPointEntity, type CadSketch } from '@wbcnc/cad';
import { measuredSketchBounds } from './curveBounds';
const round = (n: number) => Math.round(n * 1e6) / 1e6;
/** Full/on-demand reports keep editable parameters. Compact model summaries can omit these controls. */
export function nativeCurveReport(sketch: CadSketch, entity: CadEntity, ref: (id: string) => string) {
  const point = (id: string) => {
    const p = sketch.entities.find(e => e.id === id) as CadPointEntity;
    const expressions: Record<string, string> = {};
    for (const constraint of sketch.constraints)
      if ((constraint.type === 'positionX' || constraint.type === 'positionY') && constraint.pointId === id && constraint.expression)
        expressions[constraint.type === 'positionX' ? 'x' : 'y'] = constraint.expression;
    return { ref: ref(id), at: [round(p.x), round(p.y)], ...(Object.keys(expressions).length && { expressions }) };
  };
  let bounds: { at: number[]; size: number[] } | undefined;
  try {
    const measured = measuredSketchBounds(sketch, new Set([entity.id]));
    bounds = { at: measured.at.map(round), size: measured.size.map(round) };
  } catch {
    /* A valid higher-degree rational spline can still be reported without an exact fitted box. */
  }
  if (entity.type === 'bezier')
    return {
      degree: entity.controlPointIds.length - 1,
      ends: [ref(entity.startId), ref(entity.endId)],
      controls: entity.controlPointIds.map(point),
      ...(bounds && { bounds }),
    };
  if (entity.type === 'spline')
    return {
      degree: entity.degree,
      closed: !!entity.closed,
      ends: [ref(entity.startId), ref(entity.endId)],
      controls: entity.controlPointIds.map(point),
      fitPoints: entity.fitPointIds.map(point),
      fitParameters: entity.fitParameters.map(round),
      knots: entity.knots.map(round),
      weights: entity.weights.map(round),
      ...(bounds && { bounds }),
    };
  if (entity.type === 'ellipse')
    return {
      center: point(entity.centerId),
      focus: point(entity.focusId),
      major: [entity.majorStartId, entity.majorEndId].map(point),
      minor: [entity.minorStartId, entity.minorEndId].map(point),
      minorRadius: round(entity.radius),
      ...(bounds && { bounds }),
    };
  if (entity.type === 'conic')
    return {
      rho: entity.rho,
      ends: [ref(entity.startId), ref(entity.endId)],
      controls: [entity.startId, entity.controlId, entity.endId].map(point),
      ...(bounds && { bounds }),
    };
  return {};
}
export function sketchCurveDetails(sketch: CadSketch, entityRef: (id: string) => string, constraintRef: (id: string) => string) {
  const offsets = sketch.constraints
    .filter(c => c.type === 'offset')
    .map(c => ({
      ref: constraintRef(c.id),
      distance: c.value,
      ...(c.expression && { expression: c.expression }),
      members: c.members.map(m => ({ type: m.kind, source: entityRef(m.sourceId), target: entityRef(m.targetId), side: m.side })),
    }));
  const fittingConstraints = sketch.constraints.filter(c => c.label?.startsWith('Fit ') && 'value' in c);
  const fittingReferences = new Set(fittingConstraints.flatMap(constraintEntityIds));
  const fittedCurves = new Set(
    sketch.entities
      .filter(entity => fittingReferences.has(entity.id) || entityPointIds(entity).some(id => fittingReferences.has(id)))
      .map(entity => entity.id)
  );
  const drivers = fittingConstraints.map(c => ({
    ref: constraintRef(c.id),
    type: c.type,
    entities: constraintEntityIds(c).map(entityRef),
    ...('value' in c && { value: c.value, ...(c.expression && { expression: c.expression }) }),
  }));
  let fitting: { bounds?: { at: number[]; size: number[] }; drivers: typeof drivers } | undefined;
  if (drivers.length) {
    try {
      const bounds = measuredSketchBounds(sketch, fittedCurves);
      fitting = { bounds: { at: bounds.at.map(round), size: bounds.size.map(round) }, drivers };
    } catch {
      fitting = { drivers };
    }
  }
  return { ...(offsets.length && { offsets }), ...(fitting && { fitting }) };
}
