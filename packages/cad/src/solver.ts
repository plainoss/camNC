import { reconcileSlot } from './slot';
import { slotArcRuleOverrides } from './slotConstraint';
import { Algorithm, GcsWrapper, SolveStatus, type ModuleStatic, type SketchPrimitive } from '@salusoft89/planegcs';
import { resolveExtrudeSteps } from './extrudeSteps';
import { withUsedPoints } from './usedEdges';
import { resolveUpTo } from './upTo';
import { resolveDatumPlanes } from './datumPlanes';
import { sketchTargets } from './featureModel';
import { evaluateCadDocument } from './features';
import { requiresInstanceEvaluation } from './requiresInstanceEvaluation';
import { validateCadDocument, CAD_GEOMETRY_TOLERANCE } from './geometry';
import type { CadArcEntity, CadDocument, CadLineEntity, CadNurbsEntity, CadPart, CadPointEntity, CadSolveResult } from './types';
import { isNurbsCurve, rationalCurveData } from './curves';
import { cadSolverRuntime, initializeCadSolver, poisonedModules, destroyCadSolverWrapper as destroyWrapper } from './solverRuntime';
export { initializeCadSolver } from './solverRuntime';
import { fixedConstraintConflicts } from './fixedConstraints';
import { pointEquivalence } from './pointEquivalence';
import { classifyNativeEntities } from './entityFreedom';
import { refreshDimensionMeasurement } from './dimensions';
import { applyCadVariables } from './variables';
import { resolveDrawnPlacements } from './drawnOn';
import { withFaceEdges } from './faceEdges';
import { resolvePartPatterns } from './partPatterns';
import { isFatalSolverError } from './solverFailure';
import { invalidOffsetBranches, offsetNativeSeed } from './offsetConstraint';
import { entityPointIds } from './document';
import { patternReplicaIds } from './patternConstraint';
import { reconcileLinearPattern, linearPatternReservationIssue } from './pattern';
import { conditionPatternEllipseAxes } from './patternEllipse';
import { compilePatternTopology } from './patternTopology';
import { conditionEllipseAxes } from './ellipse';
import { trimCadFolders } from './folderModel';
import { supportsFirst } from './solveOrder';
import { withSplineHandleSegments } from './splineHandles';
import {
  applySolvedGeometry,
  nativeCurveData,
  pushConditionedPrimitive,
  solvedCurveEquationsHold,
  solverConstraint,
  solverGeometry,
} from './solverPrimitives';

export interface CadSolveOptions {
  wasmUrl?: string;
  /** Low-priority edit intent: existing dimensions win over pointer movement. */
  drag?: CadDragTarget | CadDragTarget[];
  /** Low-priority circumference edit: a driving radius/diameter dimension still takes precedence. */
  radiusDrag?: { entityId: string; radius: number };
  /** Optional native rank analysis; hosts may defer this during pointer movement. */
  classifyEntities?: boolean;
  /** Optional analysis shares this measured budget with the primary native solve. Geometry solving is never truncated. */
  entityAnalysisBudgetMs?: number;
  /** Solve the drawing only. A face sketch can be open or cross itself, because it's never a part's profile. */
  sketchOnly?: boolean;
}
export interface CadDragTarget {
  pointId: string;
  x: number;
  y: number;
}

/** Solve a detached revision. Callers retain their accepted model while an invalid draft is edited. */

function* solveCadSteps(document: CadDocument, options: CadSolveOptions): Generator<string | undefined, CadSolveResult, ModuleStatic> {
  // Values that use variables follow them before anything is solved.
  let next = structuredClone(resolveUpTo(resolveDatumPlanes(applyCadVariables(resolveExtrudeSteps(document)))));
  for (const part of next.parts) {
    part.sketch = withSplineHandleSegments(part.sketch);
    for (const feature of part.features ?? []) if (feature.type === 'sketch') feature.sketch = withSplineHandleSegments(feature.sketch);
  }
  const patternDiagnostics: CadSolveResult['diagnostics'] = [];
  for (const part of next.parts.flatMap(sketchTargets)) {
    for (const slot of part.sketch.constraints.filter(c => c.type === 'slot')) {
      try {
        const result = reconcileSlot(part.sketch, slot);
        if (result.ok) {
          part.sketch.entities = result.sketch.entities;
        } else
          patternDiagnostics.push({
            code: 'invalid-slot',
            message: result.message,
            severity: 'error',
            partId: part.id,
            constraintIds: [slot.id],
          });
      } catch {
        patternDiagnostics.push({
          code: 'invalid-slot',
          message: 'Repair the saved slot data before solving.',
          severity: 'error',
          partId: part.id,
          constraintIds: [slot.id],
        });
      }
    }
    const patterns = part.sketch.constraints.filter(c => c.type === 'linearPattern' || c.type === 'circularPattern');
    const invalid = patterns.map(pattern => ({ pattern, issue: linearPatternReservationIssue(part.sketch, pattern) })).filter(v => v.issue);
    if (invalid.length) {
      for (const { pattern, issue } of invalid)
        patternDiagnostics.push({
          code: 'invalid-pattern',
          message: issue!,
          severity: 'error',
          partId: part.id,
          constraintIds: [pattern.id],
        });
      continue;
    }
    conditionPatternEllipseAxes(part.sketch);
    for (const pattern of patterns) {
      try {
        const result = reconcileLinearPattern(part.sketch, pattern);
        if (result.ok) {
          part.sketch.entities = result.sketch.entities;
          part.sketch.constraints = result.sketch.constraints;
        } else
          patternDiagnostics.push({
            code: 'invalid-pattern',
            message: result.message,
            severity: 'error',
            partId: part.id,
            constraintIds: [pattern.id],
          });
      } catch {
        patternDiagnostics.push({
          code: 'invalid-pattern',
          message: 'Repair the saved pattern data before solving.',
          severity: 'error',
          partId: part.id,
          constraintIds: [pattern.id],
        });
      }
    }
  }
  const diagnostics = [...patternDiagnostics, ...validateCadDocument(next)];
  const sketches: CadSolveResult['sketches'] = [];
  if (diagnostics.some(d => d.severity === 'error')) return { document: next, status: 'invalid', diagnostics, parts: [], sketches };
  const targets = options.drag ? (Array.isArray(options.drag) ? options.drag : [options.drag]) : [];
  const dragTargets = [...new Map(targets.map(target => [target.pointId, target])).values()];
  if (dragTargets.some(target => ![target.x, target.y].every(Number.isFinite)))
    return {
      document: next,
      status: 'invalid',
      diagnostics: [{ code: 'invalid-drag', message: 'Drag coordinates must be finite.', severity: 'error' }],
      parts: [],
      sketches,
    };
  if (options.radiusDrag && (!Number.isFinite(options.radiusDrag.radius) || options.radiusDrag.radius <= CAD_GEOMETRY_TOLERANCE)) {
    return {
      document: next,
      status: 'invalid',
      diagnostics: [{ code: 'invalid-drag', message: 'A radius drag needs a finite radius greater than zero.', severity: 'error' }],
      parts: [],
      sketches,
    };
  }
  let nativeModule: ModuleStatic | undefined;
  let nativePromise: Promise<ModuleStatic> | undefined;
  try {
    let module = yield options.wasmUrl;
    nativePromise = cadSolverRuntime.promise!;
    nativeModule = module;
    // Solving replaces each sketch's contents in place, so the face sketches update through their targets. A part
    // drawn on another is solved after it, with that face's edges where they now are, so what's tied to them follows.
    for (const part of supportsFirst(next.parts).flatMap(sketchTargets)) {
      if (part.drawnOn) part.sketch = withFaceEdges(next, part);
      // Points used from other parts' corners go where those corners now are.
      part.sketch = withUsedPoints(next, part);
      const fixedConflicts = fixedConstraintConflicts(part);
      if (fixedConflicts.length) {
        diagnostics.push(...fixedConflicts);
        sketches.push({ partId: part.id, dof: -1, status: 'conflict' });
        continue;
      }
      if (poisonedModules.has(module)) {
        module = yield options.wasmUrl;
        nativePromise = cadSolverRuntime.promise!;
        nativeModule = module;
      }
      let wrapper = new GcsWrapper(new module.GcsSystem(), module);
      try {
        conditionEllipseAxes(part.sketch);
        const entities = new Map(part.sketch.entities.map(e => [e.id, e]));
        const fixedArcs: CadArcEntity[] = [];
        for (const entity of part.sketch.entities) {
          if (entity.type !== 'arc') continue;
          const points = [entity.centerId, entity.startId, entity.endId].map(id => entities.get(id) as CadPointEntity);
          if (!points.every(point => point.fixed)) continue;
          const [center, start, end] = points as [CadPointEntity, CadPointEntity, CadPointEntity];
          const radius = Math.hypot(start.x - center.x, start.y - center.y);
          const endRadius = Math.hypot(end.x - center.x, end.y - center.y);
          if (radius <= CAD_GEOMETRY_TOLERANCE || Math.abs(radius - endRadius) > CAD_GEOMETRY_TOLERANCE) {
            diagnostics.push({
              code: 'constraint-conflict',
              message: 'The fixed arc endpoints must lie on the same circle around its fixed center.',
              severity: 'error',
              partId: part.id,
              entityIds: [entity.id, ...points.map(point => point.id)],
            });
            continue;
          }
          const near = (angle: number, previous: number) => angle + 2 * Math.PI * Math.round((previous - angle) / (2 * Math.PI));
          entity.radius = radius;
          entity.startAngle = near(Math.atan2(start.y - center.y, start.x - center.x), entity.startAngle);
          entity.endAngle = near(Math.atan2(end.y - center.y, end.x - center.x), entity.endAngle);
          fixedArcs.push(entity);
        }
        if (diagnostics.some(d => d.partId === part.id && d.severity === 'error')) {
          sketches.push({ partId: part.id, dof: -1, status: 'conflict' });
          continue;
        }
        // Points must precede curves; document order has no semantic significance.
        const ordered = [...part.sketch.entities].sort((a, b) => Number(a.type !== 'point') - Number(b.type !== 'point'));
        const points = new Map(ordered.filter((e): e is CadPointEntity => e.type === 'point').map(e => [e.id, e]));
        const offsetSeed = offsetNativeSeed(part.sketch);
        const geometry: SketchPrimitive[] = ordered.map(e => solverGeometry(offsetSeed.get(e.id) ?? e, points));
        const primitives: SketchPrimitive[] = [];
        const draggedIds = new Set(dragTargets.map(target => target.pointId));
        const slotCaps = new Set([
          ...part.sketch.constraints.flatMap(c => (c.type === 'slot' ? c.capIds : [])),
          ...slotArcRuleOverrides(
            part.sketch.constraints.filter(c => c.type === 'slot'),
            entities
          ),
        ]);
        const replicas = patternReplicaIds(part.sketch.constraints.filter(c => c.type === 'linearPattern' || c.type === 'circularPattern'));
        const retainedSplineHandles = new Set<string>();
        for (const e of ordered)
          if (e.type === 'spline' && [...e.fitPointIds, ...e.controlPointIds].some(id => draggedIds.has(id))) {
            for (const id of [...e.fitPointIds, ...(e.closed ? [] : [e.controlPointIds[1]!, e.controlPointIds.at(-2)!])])
              if (!draggedIds.has(id)) retainedSplineHandles.add(id);
          }
        for (const id of retainedSplineHandles) {
          const p = points.get(id)!;
          if (!p.fixed)
            primitives.push(
              { id: `${id}:retain-x`, type: 'coordinate_x', p_id: id, x: p.x, temporary: true },
              { id: `${id}:retain-y`, type: 'coordinate_y', p_id: id, y: p.y, temporary: true }
            );
        }
        for (const e of ordered)
          if (e.type === 'spline' && !replicas.has(e.id)) {
            const data = rationalCurveData(e, points),
              lo = data.knots[data.degree]!,
              hi = data.knots[data.poles.length]!;
            e.fitPointIds.forEach((pointId, i) => {
              if (!e.closed && (i === 0 || i === e.fitPointIds.length - 1)) return;
              primitives.push({
                id: `${e.id}:fit:${i}`,
                type: 'point_on_bspline',
                p_id: pointId,
                b_id: e.id,
                pointparam: lo + e.fitParameters[i]! * (hi - lo),
              });
            });
          }
        for (const e of ordered)
          if (e.type === 'ellipse' && !replicas.has(e.id)) {
            if (entityPointIds(e).every(id => points.get(id)?.fixed)) {
              // Fixed endpoints already determine the shape. Eight alignment equations
              // would overconstrain the sole remaining native radius parameter.
              const a = points.get(e.minorStartId)!,
                b = points.get(e.minorEndId)!;
              primitives.push({
                id: `${e.id}:fixed-radius`,
                type: 'equal',
                param1: { o_id: e.id, prop: 'radmin' },
                param2: Math.hypot(a.x - b.x, a.y - b.y) / 2,
              });
            } else
              primitives.push(
                {
                  id: `${e.id}:major`,
                  type: 'internal_alignment_ellipse_major_diameter',
                  e_id: e.id,
                  p1_id: e.majorStartId,
                  p2_id: e.majorEndId,
                },
                {
                  id: `${e.id}:minor`,
                  type: 'internal_alignment_ellipse_minor_diameter',
                  e_id: e.id,
                  p1_id: e.minorStartId,
                  p2_id: e.minorEndId,
                }
              );
          }
        for (const e of ordered)
          if (e.type === 'arc' && !replicas.has(e.id) && !slotCaps.has(e.id)) {
            // With all three points fixed, four arc rules overconstrain three native arc parameters.
            // Keep one native radius equation so contradictory user dimensions remain detectable.
            primitives.push(
              fixedArcs.includes(e)
                ? { id: `${e.id}:fixed-radius`, type: 'arc_radius', a_id: e.id, radius: e.radius }
                : { id: `${e.id}:arc-rules`, type: 'arc_rules', a_id: e.id }
            );
          }
        const coincident = pointEquivalence(part.sketch.constraints);
        const topology = compilePatternTopology(part.sketch);
        primitives.push(...topology.primitives);
        primitives.push(
          ...part.sketch.constraints.flatMap(c =>
            (c.type === 'coincident' && topology.skipCoincidences.has(c.id)) || ('value' in c && c.driven)
              ? []
              : solverConstraint(c, entities, coincident, part.sketch.constraints, offsetSeed)
          )
        );
        for (const drag of dragTargets)
          if (entities.get(drag.pointId)?.type === 'point')
            primitives.push(
              { id: `${drag.pointId}:drag-x`, type: 'coordinate_x', p_id: drag.pointId, x: drag.x, temporary: true },
              { id: `${drag.pointId}:drag-y`, type: 'coordinate_y', p_id: drag.pointId, y: drag.y, temporary: true }
            );
        const radiusDrag = options.radiusDrag;
        if (radiusDrag) {
          const curve = entities.get(radiusDrag.entityId);
          if (curve?.type === 'circle')
            primitives.push({
              id: `${curve.id}:drag-radius`,
              type: 'circle_radius',
              c_id: curve.id,
              radius: radiusDrag.radius,
              temporary: true,
            });
          else if (curve?.type === 'arc')
            primitives.push({
              id: `${curve.id}:drag-radius`,
              type: 'arc_radius',
              a_id: curve.id,
              radius: radiusDrag.radius,
              temporary: true,
            });
        }
        const populate = (target: GcsWrapper) => {
          target.push_primitives_and_params(structuredClone(geometry));
          for (const entity of ordered)
            if (isNurbsCurve(entity) && entity.type !== 'ellipse') {
              const data = nativeCurveData(entity, points),
                ids = data.poleIds;
              const addr = (id: string) => {
                const i = target.p_param_index.get(id);
                if (i === undefined) throw new Error('Missing native curve point.');
                return i;
              };
              const vector = (values: number[]) => {
                const v = new module.IntVector();
                values.forEach(value => v.push_back(value));
                return v;
              };
              const knots = data.knots;
              const poles = vector(ids.flatMap(id => [addr(id), addr(id) + 1]));
              const weights = vector(data.weights.map(w => target.gcs.push_p_param(w, true)));
              const knotValues = vector(knots.map(k => target.gcs.push_p_param(k, true)));
              const multiplicities = vector(data.mult);
              // Native endpoint normals recognize the cached endpoint parameter address. Logical aliases
              // share only those cache references; source point/pole IDs and their equations stay separate.
              try {
                target.bspline_gcs_cache.set(
                  entity.id,
                  target.gcs.make_bspline(
                    addr(coincident.canonical(entity.startId)),
                    addr(coincident.canonical(entity.startId)) + 1,
                    addr(coincident.canonical(entity.endId)),
                    addr(coincident.canonical(entity.endId)) + 1,
                    poles,
                    weights,
                    knotValues,
                    multiplicities,
                    data.degree,
                    data.periodic
                  )
                );
              } finally {
                poles.delete();
                weights.delete();
                knotValues.delete();
                multiplicities.delete();
              }
            }
          for (const c of part.sketch.constraints)
            if (c.type === 'pointOnCurve' && !c.parameterFixed && entities.get(c.entityId)?.type !== 'ellipse') {
              const data = rationalCurveData(entities.get(c.entityId) as CadNurbsEntity, points),
                lo = data.knots[data.degree]!,
                hi = data.knots[data.poles.length]!;
              target.push_sketch_param(`${c.id}:parameter`, lo + c.parameter * (hi - lo), false);
            }
          for (const c of part.sketch.constraints) {
            if ('value' in c && c.driven) continue;
            if (c.type === 'offset') {
              target.push_sketch_param(`${c.id}:offset-magnitude`, Math.abs(c.value));
              target.push_sketch_param(`${c.id}:offset-value`, c.value);
              continue;
            }
            if (c.type === 'circleCircleDistance') {
              const a = entities.get(c.entityAId) as import('./types').CadCircleEntity | CadArcEntity,
                b = entities.get(c.entityBId) as import('./types').CadCircleEntity | CadArcEntity;
              const ca = points.get(a.centerId)!,
                cb = points.get(b.centerId)!;
              const distance = Math.hypot(cb.x - ca.x, cb.y - ca.y);
              if (!coincident.equivalent(a.centerId, b.centerId)) target.push_sketch_param(`${c.id}:center-distance`, distance, false);
              target.push_sketch_param(`${c.id}:radius-distance`, distance + c.radiusASign * a.radius, false);
              continue;
            }
            if (c.type !== 'pointArcDistance' && c.type !== 'lineCircleDistance') continue;
            const circular = entities.get(c.type === 'pointArcDistance' ? c.entityId : c.entityBId) as
              | import('./types').CadCircleEntity
              | CadArcEntity;
            const center = points.get(circular.centerId)!;
            let distance: number;
            if (c.type === 'pointArcDistance') {
              const point = points.get(c.pointId)!;
              distance = Math.hypot(point.x - center.x, point.y - center.y);
            } else {
              const line = entities.get(c.entityAId) as CadLineEntity;
              const a = points.get(line.startId)!,
                b = points.get(line.endId)!;
              distance = Math.abs((b.x - a.x) * (center.y - a.y) - (b.y - a.y) * (center.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y);
            }
            target.push_sketch_param(`${c.id}:center-distance`, distance, false);
          }
          for (const primitive of structuredClone(primitives)) pushConditionedPrimitive(target, primitive);
          for (const arc of fixedArcs) {
            // PlaneGCS 1.3.0 exposes arc parameters in start-angle, end-angle, radius order.
            const index = target.p_param_index.get(arc.id);
            if (index === undefined) throw new Error('The fixed arc was not registered with the solver.');
            target.gcs.set_p_param(index, arc.startAngle, true);
            target.gcs.set_p_param(index + 1, arc.endAngle, true);
          }
        };
        populate(wrapper);
        let solveStatus: SolveStatus = SolveStatus.Failed;
        let conflicts: string[] = [],
          redundant: string[] = [];
        let candidate: CadPart | undefined;
        let invalidOffsets: string[] = [];
        let nativeSolveMs = 0;
        for (const algorithm of [Algorithm.DogLeg, Algorithm.LevenbergMarquardt, Algorithm.BFGS]) {
          if (algorithm !== Algorithm.DogLeg) {
            const fresh = new GcsWrapper(new module.GcsSystem(), module);
            try {
              populate(fresh);
            } catch (error) {
              destroyWrapper(fresh);
              throw error;
            }
            destroyWrapper(wrapper);
            wrapper = fresh;
          }
          candidate = undefined;
          const solveStarted = performance.now();
          solveStatus = wrapper.solve(algorithm);
          nativeSolveMs += performance.now() - solveStarted;
          const sourceConstraintId = (id: string) => {
            const offset = part.sketch.constraints.find(c => c.type === 'offset' && id.startsWith(`${c.id}:offset:`));
            if (offset) return offset.id;
            const suffix = [':parallel', ':radius-gap', ':radius-a', ':radius-b'].find(suffix => id.endsWith(suffix));
            const parent =
              suffix &&
              part.sketch.constraints.find(
                c =>
                  c.id === id.slice(0, -suffix.length) &&
                  ['lineLineDistance', 'pointArcDistance', 'lineCircleDistance', 'circleCircleDistance'].includes(c.type)
              );
            return parent ? parent.id : id;
          };
          conflicts = [...new Set(wrapper.get_gcs_conflicting_constraints().map(sourceConstraintId))];
          redundant = [...new Set(wrapper.get_gcs_redundant_constraints().map(sourceConstraintId))];
          // A real driving conflict is never hidden by an algorithm retry.
          if (conflicts.length) break;
          if (solveStatus !== SolveStatus.Success) continue;
          const solvedPart = structuredClone(part);
          applySolvedGeometry(solvedPart, wrapper);
          invalidOffsets = invalidOffsetBranches(solvedPart.sketch);
          if (invalidOffsets.length) continue;
          // DogLeg can report success at a degenerate zero-radius branch of an underconstrained
          // arc network. Retry the untouched source with another native algorithm before publishing it.
          // Open profiles are intentionally excluded: they remain normal editable sketch geometry.
          if (
            solvedCurveEquationsHold(solvedPart) &&
            // This is a temporary single-part probe. Full-document validation above retains every membership error;
            // references to the other valid folder members must not make this individual sketch look unsolved.
            !validateCadDocument(trimCadFolders({ ...next, parts: [solvedPart] })).some(diagnostic => diagnostic.severity === 'error')
          ) {
            candidate = solvedPart;
            break;
          }
        }
        const sourceConstraintId = (nativeId: string) =>
          part.sketch.constraints.find(
            c =>
              (c.type === 'regularPolygon' ||
                c.type === 'symmetricCurves' ||
                c.type === 'linearPattern' ||
                c.type === 'circularPattern' ||
                c.type === 'slot') &&
              nativeId.startsWith(`${c.id}:`)
          )?.id ?? nativeId;
        const status = conflicts.length ? 'conflict' : candidate ? 'solved' : 'invalid';
        sketches.push({ partId: part.id, dof: wrapper.gcs.dof(), status });
        if (status !== 'solved') {
          diagnostics.push({
            code: conflicts.length ? 'constraint-conflict' : invalidOffsets.length ? 'invalid-offset' : 'solver-failed',
            message: conflicts.length
              ? 'These dimensions or constraints conflict. Edit or remove one to continue.'
              : invalidOffsets.length
                ? 'That offset would reverse or consume a copied edge. Choose a smaller distance.'
                : 'The sketch solver could not find a valid solution. Undo the last edit or adjust the geometry.',
            severity: 'error',
            partId: part.id,
            constraintIds:
              invalidOffsets.length && !conflicts.length
                ? invalidOffsets
                : [...new Set(conflicts.map(sourceConstraintId).filter(id => part.sketch.constraints.some(c => c.id === id)))],
            entityIds: conflicts.flatMap(id => {
              const suffix = [':arc-rules', ':fixed-radius'].find(suffix => id.endsWith(suffix));
              return suffix ? [id.slice(0, -suffix.length)] : [];
            }),
          });
          continue;
        }
        part.sketch.entities = candidate!.sketch.entities;
        part.sketch.constraints = candidate!.sketch.constraints;
        part.sketch.constraints = part.sketch.constraints.map(c =>
          'value' in c && c.driven ? refreshDimensionMeasurement(part.sketch, c) : c
        );
        if (redundant.length)
          diagnostics.push({
            code: 'redundant-constraint',
            message: 'Some constraints repeat relationships that are already defined.',
            severity: 'warning',
            partId: part.id,
            constraintIds: [...new Set(redundant.map(sourceConstraintId))],
          });
        if (wrapper.gcs.dof() > 0)
          diagnostics.push({
            code: 'underconstrained',
            message: `${wrapper.gcs.dof()} degrees of freedom remain. Add dimensions to keep this shape predictable.`,
            severity: 'warning',
            partId: part.id,
          });
        let classificationReset = false;
        if (options.classifyEntities) {
          const sketchStatus = sketches.at(-1)!;
          const analysisStarted = performance.now();
          try {
            const analysis = classifyNativeEntities(part.sketch, wrapper, {
              budgetMs: options.entityAnalysisBudgetMs,
              spentMs: nativeSolveMs,
              isAborted: () => poisonedModules.has(module),
            });
            sketchStatus.entityStatus = analysis.status;
            sketchStatus.entityAnalysis = {
              elapsedMs: analysis.elapsedMs,
              probes: analysis.probes,
              complete: analysis.complete,
              ...(analysis.limitedBy && { limitedBy: analysis.limitedBy }),
            };
          } catch (error) {
            classificationReset = isFatalSolverError(error) || poisonedModules.has(module);
            if (classificationReset) {
              // Geometry and global DOF were already validated before this optional query.
              // Discard only the aborted analysis engine; later parts use a fresh module.
              poisonedModules.add(module);
              if (cadSolverRuntime.promise === nativePromise) cadSolverRuntime.promise = undefined;
            }
            sketchStatus.entityStatus = Object.fromEntries(part.sketch.entities.map(entity => [entity.id, 'unknown']));
            sketchStatus.entityAnalysis = {
              elapsedMs: performance.now() - analysisStarted,
              probes: -1,
              complete: false,
              limitedBy: classificationReset ? 'engine-reset' : 'failure',
            };
          }
          if (sketchStatus.entityAnalysis?.complete === false) {
            diagnostics.push({
              code: 'entity-analysis-limited',
              severity: 'warning',
              partId: part.id,
              message: classificationReset
                ? 'The sketch is solved. Constraint color analysis stopped and its engine was reset.'
                : sketchStatus.entityAnalysis.limitedBy === 'budget'
                  ? 'The sketch is solved; some constraint colors are unavailable because analysis reached its time budget.'
                  : 'The sketch is solved; some entity constraint colors could not be determined.',
            });
          }
        }
        if (!classificationReset && poisonedModules.has(module)) throw new WebAssembly.RuntimeError('The native sketch solver aborted.');
      } catch (error) {
        if (isFatalSolverError(error) || poisonedModules.has(module)) {
          poisonedModules.add(module);
          if (cadSolverRuntime.promise === nativePromise) cadSolverRuntime.promise = undefined;
        }
        throw error;
      } finally {
        destroyWrapper(wrapper);
      }
    }
  } catch (error) {
    if (isFatalSolverError(error) || (nativeModule && poisonedModules.has(nativeModule))) {
      if (nativeModule) poisonedModules.add(nativeModule);
      if (cadSolverRuntime.promise === nativePromise) cadSolverRuntime.promise = undefined;
      return {
        document: structuredClone(document),
        status: 'invalid',
        parts: [],
        diagnostics: [
          {
            code: 'solver-restarted',
            severity: 'error',
            message: 'The sketch solver stopped and its engine was reset. Your sketch is unchanged; try the edit again.',
          },
        ],
        sketches: document.parts.map(part => ({ partId: part.id, dof: -1, status: 'invalid' })),
      };
    }
    const detail = error instanceof Error ? error.message : String(error);
    diagnostics.push({ code: 'solver-error', message: `Could not solve this sketch: ${detail}`, severity: 'error' });
  }
  // Shared sketches, and what Add and Remove steps make, follow the sketches as solved.
  next = resolveUpTo(resolveExtrudeSteps(next));
  if (diagnostics.some(d => d.severity === 'error')) {
    return {
      document: next,
      status: sketches.some(s => s.status === 'conflict') ? 'conflict' : 'invalid',
      diagnostics,
      parts: [],
      sketches,
    };
  }
  if (options.sketchOnly) return { document: next, status: 'solved', diagnostics, parts: [], sketches };
  let evaluated = evaluateCadDocument(next);
  // Parts drawn on others go where those parts now are, and patterns lay their copies out from there.
  const resolved = resolveDrawnPlacements(next, evaluated.parts);
  const placed = resolvePartPatterns(resolved.document);
  // Cut-parts and Remove volumes intersect copies where patterns and transforms place them now.
  // Copy-specific features follow the final pattern count too, including dormant features when a copy disappears.
  if (placed !== next && requiresInstanceEvaluation(placed)) evaluated = evaluateCadDocument(placed);
  diagnostics.push(...resolved.diagnostics, ...evaluated.diagnostics);
  return {
    ...evaluated,
    document: placed,
    status: diagnostics.some(d => d.severity === 'error') ? 'invalid' : 'solved',
    diagnostics,
    sketches,
    featuresEvaluated: true,
  };
}
/** Solve with module loading and recovery available between sketches. */
export async function solveCadDocument(document: CadDocument, options: CadSolveOptions = {}): Promise<CadSolveResult> {
  const steps = solveCadSteps(document, options);
  let result = steps.next();
  while (!result.done) {
    try {
      await initializeCadSolver(result.value);
      result = steps.next(cadSolverRuntime.module!);
    } catch (error) {
      result = steps.throw(error);
    }
  }
  return result.value;
}
/**
 * Resolve a script's geometric query after initializeCadSolver has completed. Uses the same solver as the async
 * entry, without replaying the script or changing identities. A native abort leaves the input unchanged.
 */
export function solveCadDocumentNow(document: CadDocument, options: CadSolveOptions = {}): CadSolveResult {
  const module = cadSolverRuntime.module;
  if (!module || poisonedModules.has(module)) throw new Error('Initialize the CAD solver before a synchronous geometric query.');
  const steps = solveCadSteps(document, options);
  let result = steps.next();
  while (!result.done) {
    if (poisonedModules.has(module)) result = steps.throw(new WebAssembly.RuntimeError('The native sketch solver aborted.'));
    else result = steps.next(module);
  }
  return result.value;
}
