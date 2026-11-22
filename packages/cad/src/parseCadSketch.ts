import { slotIssue } from './slot';
import { linearPatternIssue } from './pattern';
import { splineHandleIssue } from './splineHandles';
import { constraintEntityIds, entityPointIds } from './entityReferences';
import { number, reference } from './parseCadChecks';
import type { CadSketch } from './types';

/** Check a loaded sketch's entities and constraints, adding their IDs with `add`. */
export function checkCadSketch(sketch: CadSketch, add: (id: unknown) => void): void {
  for (const e of sketch.entities) {
    if (!e || typeof e !== 'object') throw new Error('Invalid CAD entity');
    add(e.id);
    if (!['point', 'line', 'circle', 'ellipse', 'arc', 'conic', 'bezier', 'spline'].includes(e.type)) throw new Error('Unknown CAD entity');
    if (e.construction !== undefined && typeof e.construction !== 'boolean') throw new Error('Invalid construction flag');
    if (e.taken !== undefined && (e.taken !== true || !e.faceEdge)) throw new Error('Invalid taken face edge');
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
        if (typeof c.centerId !== 'string' || typeof c.closed !== 'boolean') throw new Error('Invalid circular pattern center or sweep.');
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
    if ('labelPlacement' in c && c.labelPlacement !== undefined) {
      if (!('value' in c) || !c.labelPlacement || typeof c.labelPlacement !== 'object')
        throw new Error('Invalid dimension label placement');
      const placement = c.labelPlacement;
      if (placement.kind === 'linear') {
        if (c.type === 'radius' || c.type === 'diameter' || c.type === 'angle') throw new Error('Invalid dimension label placement kind');
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
      } else if (placement.kind === 'angle') {
        if (c.type !== 'angle') throw new Error('Invalid dimension label placement kind');
        number(placement.radius);
        number(placement.angleOffset);
        if (placement.radius < 0) throw new Error('Invalid dimension label radius');
      } else if (placement.kind === 'fallback') {
        if (!placement.offset || typeof placement.offset !== 'object') throw new Error('Invalid dimension label fallback');
        number(placement.offset.x);
        number(placement.offset.y);
      } else if (placement.kind === 'absolute') {
        if (!placement.position || typeof placement.position !== 'object') throw new Error('Invalid dimension label position');
        number(placement.position.x);
        number(placement.position.y);
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
    if (
      c.type === 'circleCircleDistance' &&
      (![c.radiusASign, c.radiusBSign, c.direction].every(value => value === 1 || value === -1) ||
        (c.angle !== undefined && !Number.isFinite(c.angle)))
    )
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
