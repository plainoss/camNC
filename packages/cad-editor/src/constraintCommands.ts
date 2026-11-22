import { t as translate } from '@wbcnc/i18n';
import {
  pointEquivalence,
  reflectAcrossLine,
  closestCurvePoint,
  curveEndpointIds,
  entityPointIds,
  isNurbsCurve,
  type CadConstraint,
  type CadEntity,
  type CadPointEntity,
  type CadSketch,
  type NewCadConstraint,
} from '@wbcnc/cad';

export type ConstraintCommandTool =
  | 'horizontal'
  | 'vertical'
  | 'coincident'
  | 'concentric'
  | 'symmetric'
  | 'midpoint'
  | 'parallel'
  | 'perpendicular'
  | 'equal'
  | 'tangent'
  | 'normal'
  | 'pierce'
  | 'curvature';
export interface ConstraintSelectionResult {
  constraint?: NewCadConstraint;
  constraints?: NewCadConstraint[];
  needsMore: boolean;
  message: string;
  alreadyApplied?: boolean;
}

export const constraintPrompt = (tool: ConstraintCommandTool) =>
  tool === 'horizontal' || tool === 'vertical'
    ? translate('Select a line or two points to make them {{value1}}.', { value1: tool })
    : tool === 'symmetric'
      ? translate('Select the symmetry line first, then two points or compatible curves.')
      : tool === 'concentric'
        ? translate('Select circles, arcs, ellipses, or a point and a curve to share a center.')
        : tool === 'coincident'
          ? translate('Select two points, or a point and a curve, to make them coincident.')
          : tool === 'midpoint'
            ? translate('Select a point and a line to place the point at its midpoint.')
            : tool === 'normal'
              ? translate('Select a line and a circle or arc, or two lines, to make them normal.')
              : tool === 'pierce'
                ? translate('Select a point, then an edge that crosses the sketch plane.')
                : tool === 'curvature'
                  ? translate('Select two splines that share an endpoint to match their curvature there.')
                  : translate('Select two {{value1}} to make them {{value2}}.', {
                      value1: tool === 'parallel' || tool === 'perpendicular' ? translate('lines') : translate('curves'),
                      value2: tool,
                    });

function relationshipKey(c: CadConstraint | NewCadConstraint): string {
  if (c.type === 'symmetricCurves') return `${c.type}:${c.lineId}:${[c.entityAId, c.entityBId].sort().join(':')}`;
  if (c.type === 'symmetricPoints') return `${c.type}:${c.lineId}:${[c.pointAId, c.pointBId].sort().join(':')}`;
  if ('pointId' in c && 'entityId' in c) return `${c.type}:${c.pointId}:${c.entityId}`;
  if ('pointAId' in c) return `${c.type}:${[c.pointAId, c.pointBId].sort().join(':')}`;
  if ('entityAId' in c) return `${c.type}:${[c.entityAId, c.entityBId].sort().join(':')}`;
  return `${c.type}:${'entityId' in c ? c.entityId : 'pointId' in c ? c.pointId : ''}`;
}

/** The same selection rules serve preselection and an armed constraint tool. */
export function buildConstraintForSelection(
  sketch: CadSketch,
  tool: ConstraintCommandTool,
  selectedIds: string[]
): ConstraintSelectionResult {
  const selected = [...new Set(selectedIds)].map(id => sketch.entities.find(e => e.id === id)).filter((e): e is CadEntity => !!e);
  const prompt = constraintPrompt(tool);
  const equivalent = pointEquivalence(sketch.constraints);
  const invalid = (message = prompt): ConstraintSelectionResult => ({ needsMore: false, message });
  const done = (constraint: NewCadConstraint): ConstraintSelectionResult => {
    if (
      'pointAId' in constraint &&
      ['coincident', 'horizontalPoints', 'verticalPoints'].includes(constraint.type) &&
      equivalent.equivalent(constraint.pointAId, constraint.pointBId)
    )
      return { needsMore: false, alreadyApplied: true, message: translate('These points are already coincident.') };
    if (sketch.constraints.some(c => relationshipKey(c) === relationshipKey(constraint)))
      return { needsMore: false, alreadyApplied: true, message: translate('That relationship is already constrained.') };
    return {
      constraint,
      needsMore: false,
      message: translate('{{value1}}{{value2}} constraint added.', { value1: tool[0]!.toUpperCase(), value2: tool.slice(1) }),
    };
  };
  if (!selected.length) return { needsMore: true, message: prompt };
  if (tool === 'symmetric') {
    const [axis, a, b] = selected;
    if (axis?.type !== 'line') return invalid(prompt);
    const points = new Map(sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(e => [e.id, e]));
    const start = points.get(axis.startId),
      end = points.get(axis.endId);
    if (!start || !end || !reflectAcrossLine(start, start, end))
      return invalid(translate('Choose a finite symmetry line with distinct endpoints.'));
    if (selected.length < 3)
      return {
        needsMore: true,
        message: a ? translate('Select the matching second point or curve.') : translate('Select the first point or curve.'),
      };
    if (selected.length !== 3 || !a || !b) return invalid(prompt);
    if (a.type === 'point' && b.type === 'point') {
      if (equivalent.equivalent(a.id, b.id)) return invalid(translate('Choose two distinct points for symmetry.'));
      return done({ type: 'symmetricPoints', pointAId: a.id, pointBId: b.id, lineId: axis.id });
    }
    const circular = (e: CadEntity) => e.type === 'circle' || e.type === 'arc';
    if (!((a.type === 'line' && b.type === 'line') || (circular(a) && circular(b)) || (a.type === 'ellipse' && b.type === 'ellipse')))
      return invalid(translate('Choose two points, two lines, two circular curves, or two ellipses.'));
    let focusSign: 1 | -1 | undefined;
    if (a.type === 'ellipse' && b.type === 'ellipse') {
      const sourceFocus = points.get(a.focusId),
        focus = points.get(b.focusId),
        center = points.get(b.centerId);
      if (!sourceFocus || !focus || !center) return invalid(translate('Repair the ellipse points before adding symmetry.'));
      const reflected = reflectAcrossLine(sourceFocus, start, end);
      if (!reflected) return invalid(translate('Repair the ellipse points before adding symmetry.'));
      focusSign =
        Math.hypot(reflected.x - focus.x, reflected.y - focus.y) <=
        Math.hypot(reflected.x - (2 * center.x - focus.x), reflected.y - (2 * center.y - focus.y))
          ? 1
          : -1;
    }
    return done({ type: 'symmetricCurves', entityAId: a.id, entityBId: b.id, lineId: axis.id, ...(focusSign ? { focusSign } : {}) });
  }
  if (tool === 'concentric') {
    const curves = selected.filter(
      (e): e is Extract<CadEntity, { type: 'circle' | 'arc' | 'ellipse' }> =>
        e.type === 'circle' || e.type === 'arc' || e.type === 'ellipse'
    );
    const points = selected.filter(e => e.type === 'point');
    if (curves.length + points.length !== selected.length) return invalid(prompt);
    if (selected.length === 1) return { needsMore: true, message: translate('Select the next point or circular/elliptical curve.') };
    if (!curves.length) return invalid(prompt);
    if (
      points.some(point =>
        curves.some(
          curve => !equivalent.equivalent(point.id, curve.centerId) && entityPointIds(curve).some(id => equivalent.equivalent(point.id, id))
        )
      )
    )
      return invalid(translate('A curve cannot be concentric with its own rim or axis point.'));
    const ids = [...curves.map(curve => curve.centerId), ...points.map(point => point.id)];
    const centers = [...new Map(ids.map(id => [equivalent.canonical(id), id])).values()];
    if (centers.length < 2) return { needsMore: false, alreadyApplied: true, message: translate('These curves already share a center.') };
    const constraints: NewCadConstraint[] = centers
      .slice(1)
      .map(centerId => ({ type: 'coincident', pointAId: centers[0]!, pointBId: centerId, label: translate('Concentric') }));
    return constraints.length === 1
      ? { constraint: constraints[0], needsMore: false, message: translate('Concentric constraint added.') }
      : { constraints, needsMore: false, message: translate('Concentric constraints added.') };
  }
  const [a, b] = selected;
  if (tool === 'horizontal' || tool === 'vertical') {
    if (selected.length === 1 && a!.type === 'line') return done({ type: tool, entityId: a!.id });
    if (selected.length === 1 && a!.type === 'point') return { needsMore: true, message: translate('Select the second point.') };
    if (selected.length === 2 && a!.type === 'point' && b!.type === 'point')
      return done({ type: tool === 'horizontal' ? 'horizontalPoints' : 'verticalPoints', pointAId: a!.id, pointBId: b!.id });
    return invalid();
  }
  if (selected.length === 1) return { needsMore: true, message: translate('Select the second entity. ') + prompt };
  if (selected.length !== 2) return invalid();
  const point = a!.type === 'point' ? a : b!.type === 'point' ? b : undefined;
  const curve = a!.type !== 'point' ? a : b!.type !== 'point' ? b : undefined;
  if (tool === 'normal') {
    const line = a!.type === 'line' ? a : b!.type === 'line' ? b : undefined;
    const round = a!.type === 'circle' || a!.type === 'arc' ? a : b!.type === 'circle' || b!.type === 'arc' ? b : undefined;
    // A line normal to a circle runs through its center; two lines normal to each other are perpendicular.
    if (line?.type === 'line' && (round?.type === 'circle' || round?.type === 'arc')) {
      if ([line.startId, line.endId].some(id => equivalent.equivalent(id, round.centerId)))
        return { needsMore: false, alreadyApplied: true, message: translate('This line already runs through the center.') };
      return done({ type: 'pointOnLine', pointId: round.centerId, entityId: line.id, label: translate('Normal') });
    }
    if (a!.type === 'line' && b!.type === 'line') return done({ type: 'perpendicular', entityAId: a!.id, entityBId: b!.id });
    return invalid();
  }
  // Every edge of a sketch lies in its plane, so there is nothing for a point to pierce.
  if (tool === 'pierce') return invalid(translate('Pierce needs an edge that crosses the sketch plane, and sketch edges all lie in it.'));
  if (tool === 'curvature') return invalid(translate('Matching curvature between splines isn’t available yet.'));
  if (tool === 'coincident') {
    if (a!.type === 'point' && b!.type === 'point') return done({ type: 'coincident', pointAId: a!.id, pointBId: b!.id });
    if (!point || !curve) return invalid();
    if (curve.type === 'line') {
      if ([curve.startId, curve.endId].some(id => equivalent.equivalent(id, point.id)))
        return { needsMore: false, alreadyApplied: true, message: translate('This point is already an endpoint of the line.') };
      return done({ type: 'pointOnLine', pointId: point.id, entityId: curve.id });
    }
    if (curve.type === 'arc' && [curve.startId, curve.endId].some(id => equivalent.equivalent(id, point.id)))
      return { needsMore: false, alreadyApplied: true, message: translate('This point is already an endpoint of the arc.') };
    if (isNurbsCurve(curve)) {
      if (curveEndpointIds(curve).some(id => equivalent.equivalent(id, point.id)))
        return { needsMore: false, alreadyApplied: true, message: translate('This point is already a curve endpoint.') };
      const map = new Map(sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(e => [e.id, e]));
      const { parameter } = closestCurvePoint(curve, map, point);
      return done({ type: 'pointOnCurve', pointId: point.id, entityId: curve.id, parameter });
    }
    if (equivalent.equivalent(curve.centerId, point.id))
      return invalid(translate('A circle or arc center cannot also lie on its circumference.'));
    return done({ type: 'pointOnCircle', pointId: point.id, entityId: curve.id });
  }
  if (tool === 'midpoint') {
    if (!point || curve?.type !== 'line') return invalid();
    if ([curve.startId, curve.endId].some(id => equivalent.equivalent(id, point.id)))
      return invalid(translate('Select a separate point and the line to define its midpoint.'));
    return done({ type: 'midpoint', pointId: point.id, entityId: curve.id });
  }
  if (tool === 'parallel' || tool === 'perpendicular') {
    if (a!.type !== 'line' || b!.type !== 'line') return invalid();
  } else if (tool === 'equal') {
    const lines = a!.type === 'line' && b!.type === 'line';
    const round = (a!.type === 'circle' || a!.type === 'arc') && (b!.type === 'circle' || b!.type === 'arc');
    if (!lines && !round) return invalid(translate('Select two lines, or two circular curves, to make them equal.'));
  } else if (a!.type === 'point' || b!.type === 'point' || (a!.type === 'line' && b!.type === 'line')) {
    return invalid(translate('Select a line and a circular curve, or two circular curves, for tangency.'));
  }
  if (tool === 'tangent' && (isNurbsCurve(a!) || isNurbsCurve(b!)) && !equivalent.match(curveEndpointIds(a!), curveEndpointIds(b!)))
    return invalid(translate('Spline, Bézier, and conic tangency requires a shared endpoint.'));
  return done({ type: tool, entityAId: a!.id, entityBId: b!.id });
}
