import { validateExtrudeSettings } from './validateExtrudeSettings';
import { slotIssue } from './slot';
import { linearPatternIssue } from './pattern';
import { cadVariableNameError } from './valueExpressions';
import { nestedDeeperThan } from './nestingDepth';
import { validPartCutSplit } from './partCutSplit';
import type { CadDirection, CadDocument, CadPart, CadPlacement, CadSketch } from './types';
import { splineHandleIssue, withSplineHandleSegments } from './splineHandles';
import { constraintEntityIds, entityPointIds } from './entityReferences';
import { validCircularPartPattern } from './circularPartPattern';

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
    validateExtrudeSettings(p, number, reference);
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
      if (p.pattern?.circular !== undefined && !validCircularPartPattern(p.pattern.circular))
        throw new Error('Invalid CAD circular part pattern');
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
            (on.copyId !== undefined && typeof on.copyId !== 'string') ||
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
  const parsed = structuredClone(d);
  for (const part of parsed.parts) {
    part.sketch = withSplineHandleSegments(part.sketch);
    for (const feature of part.features ?? []) if (feature.type === 'sketch') feature.sketch = withSplineHandleSegments(feature.sketch);
  }
  return parsed;
}
