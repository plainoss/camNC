import { addConstraint, addPoint, constraintEntityIds, pointEquivalence, type CadEntity, type CadSketch } from '@wbcnc/cad';
import { inferredPointConstraints, type CadDrawingInference } from './drawingInference';

type SketchPoint = Extract<CadEntity, { type: 'point' }>;

export interface DrawingRelationOptions {
  /** The drawing tool that made the shape; a few tools give their clicks a meaning of their own. */
  tool: string;
  /** Which hints are clicks on the new circle or arc, so they keep a point on it. */
  curvePointIndex?: number | readonly number[];
}

/**
 * Turns what each click snapped to into relations on the new shape: coincidence with the point it landed on, a point on
 * the curve or midpoint it touched, and any axis alignment it inferred. `before` is the sketch before the shape was drawn,
 * `hints` the inference of each click in order.
 */
export function addDrawingRelations(
  before: CadSketch,
  drawn: CadSketch,
  hints: readonly (CadDrawingInference | null)[],
  { tool, curvePointIndex = -1 }: DrawingRelationOptions
): CadSketch {
  let next = drawn;
  const isNew = (e: CadEntity) => !before.entities.some(existing => existing.id === e.id);
  const createdCurve = drawn.entities.find(e => (e.type === 'circle' || e.type === 'arc') && isNew(e));
  const polygonEdge = tool === 'inscribedPolygon' ? drawn.entities.find(e => e.type === 'line' && isNew(e)) : undefined;
  const rectangleTop = tool === 'alignedRectangle' ? drawn.entities.filter(e => e.type === 'line' && isNew(e))[2] : undefined;
  for (const [index, inference] of hints.entries()) {
    if (!inference || (!inference.snap && !inference.alignments.length)) continue;
    const hint = inference.snap;
    const candidates = next.entities.filter(
      (e): e is SketchPoint => e.type === 'point' && Math.hypot(e.x - inference.point.x, e.y - inference.point.y) < 1e-7
    );
    let point: SketchPoint | undefined = candidates.find(isNew) ?? candidates[0];
    if ((Array.isArray(curvePointIndex) ? curvePointIndex.includes(index) : index === curvePointIndex) && createdCurve) {
      // A circle's rim / arc's through click needs a concrete construction point to retain its inferred intent.
      if (!point) {
        next = addPoint(next, { ...inference.point, construction: true, standalone: false });
        point = next.entities.find(
          (e): e is SketchPoint => e.type === 'point' && Math.hypot(e.x - inference.point.x, e.y - inference.point.y) < 1e-7
        );
      }
      const pointId = point?.id;
      if (pointId && !next.constraints.some(c => c.type === 'pointOnCircle' && c.pointId === pointId && c.entityId === createdCurve.id))
        next = addConstraint(next, { type: 'pointOnCircle', pointId, entityId: createdCurve.id });
    }
    if (index === 1 && polygonEdge?.type === 'line') {
      if (!point) {
        next = addPoint(next, { ...inference.point, construction: true, standalone: false });
        point = next.entities.at(-1) as SketchPoint;
      }
      next = addConstraint(next, { type: 'midpoint', pointId: point.id, entityId: polygonEdge.id });
    }
    if (index === 2 && rectangleTop?.type === 'line') {
      if (!point) {
        next = addPoint(next, { ...inference.point, construction: true, standalone: false });
        point = next.entities.at(-1) as SketchPoint;
      }
      const equivalent = pointEquivalence(next.constraints);
      if (![rectangleTop.startId, rectangleTop.endId].some(id => equivalent.equivalent(id, point!.id)))
        next = addConstraint(next, { type: 'pointOnLine', pointId: point.id, entityId: rectangleTop.id });
    }
    if (point) for (const relation of inferredPointConstraints(inference, point.id, next)) next = addConstraint(next, relation);
    if (point && hint?.targetPointId && point.id !== hint.targetPointId) {
      if (
        !next.constraints.some(
          c =>
            c.type === 'coincident' && [c.pointAId, c.pointBId].includes(point.id) && [c.pointAId, c.pointBId].includes(hint.targetPointId!)
        )
      )
        next = addConstraint(next, { type: 'coincident', pointAId: point.id, pointBId: hint.targetPointId });
      continue;
    }
    if (!hint?.intent) continue;
    const curve = before.entities.find(e => e.id === hint.intent!.entityId);
    if (!point || !curve) continue;
    const type =
      hint.intent.type === 'midpoint'
        ? 'midpoint'
        : curve.type === 'line'
          ? 'pointOnLine'
          : curve.type === 'circle' || curve.type === 'arc'
            ? 'pointOnCircle'
            : 'pointOnCurve';
    if (
      !next.constraints.some(c => c.type === type && 'pointId' in c && c.pointId === point.id && 'entityId' in c && c.entityId === curve.id)
    )
      next =
        type === 'pointOnCurve'
          ? addConstraint(next, { type, pointId: point.id, entityId: curve.id, parameter: hint.parameter ?? 0.5 })
          : addConstraint(next, { type, pointId: point.id, entityId: curve.id });
  }
  return next;
}

/** Puts typed expressions (such as `2*w`) on the size dimensions a tool just created, matched by their label. */
export function withSizeExpressions(
  before: CadSketch,
  drawn: CadSketch,
  expressions: Readonly<Record<string, string | undefined>>
): CadSketch {
  if (!Object.values(expressions).some(Boolean)) return drawn;
  return {
    ...drawn,
    constraints: drawn.constraints.map(c =>
      !before.constraints.some(existing => existing.id === c.id) && c.label && expressions[c.label]
        ? { ...c, expression: expressions[c.label] }
        : c
    ),
  };
}

/**
 * What stays selected after drawing: the new curves, without their points. A center rectangle leaves out its
 * construction diagonals, which carry no orientation relation.
 */
export function drawnSelection(before: CadSketch, drawn: CadSketch, tool: string): string[] {
  return drawn.entities
    .filter(e => !before.entities.some(existing => existing.id === e.id) && e.type !== 'point')
    .filter(
      e =>
        tool !== 'centerRectangle' ||
        drawn.constraints.some(
          c => ['horizontal', 'vertical', 'parallel', 'perpendicular'].includes(c.type) && constraintEntityIds(c).includes(e.id)
        )
    )
    .map(e => e.id);
}
