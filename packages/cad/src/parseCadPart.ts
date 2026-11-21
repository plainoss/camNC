import { validCircularPartPattern } from './circularPartPattern';
import { checkDirection, checkPlacement, checkVector, number, reference } from './parseCadChecks';
import type { CadDocument, CadPart } from './types';

/** Check how a part is set up in a loaded document: its copies, pattern, placement, move, fillets, thin wall, piece,
 * material, split, mirrors and support. Its sketches are checked by checkCadSketch. */
export function checkCadPartSetup(p: CadPart, d: CadDocument, addId: (id: unknown) => void): void {
  if (p.copies !== undefined) {
    if (!Array.isArray(p.copies)) throw new Error('Invalid CAD part copies');
    for (const copy of p.copies) {
      if (!copy || typeof copy !== 'object') throw new Error('Invalid CAD part copy');
      addId(copy.id);
      if (copy.mirrored !== undefined && typeof copy.mirrored !== 'boolean') throw new Error('Invalid CAD part copy');
      if (copy.name !== undefined && typeof copy.name !== 'string') throw new Error('Invalid CAD part copy');
      if (copy.number !== undefined && (!Number.isInteger(copy.number) || copy.number < 2)) throw new Error('Invalid CAD part copy');
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
    if (
      p.pattern?.excluded !== undefined &&
      (!Array.isArray(p.pattern.excluded) ||
        p.pattern.excluded.some(index => !Number.isInteger(index) || index < 1 || index >= 200) ||
        new Set(p.pattern.excluded).size !== p.pattern.excluded.length)
    )
      throw new Error('Invalid CAD pattern exclusions');
    if (p.pattern?.circular !== undefined && !validCircularPartPattern(p.pattern.circular))
      throw new Error('Invalid CAD circular part pattern');
    if (p.pattern?.direction !== undefined) checkDirection(p.pattern.direction);
    const vector = p.pattern?.vector;
    if (
      vector !== undefined &&
      !(Array.isArray(vector) && vector.length === 3 && vector.every(Number.isFinite) && Math.hypot(...vector) > 0)
    )
      throw new Error('Invalid CAD pattern vector');
    const { second, skipped, centered } = p.pattern ?? {};
    const unit = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) && Math.hypot(...(v as number[])) > 0;
    if (
      (centered !== undefined && centered !== true) ||
      (second !== undefined &&
        (!second ||
          !unit(second.vector) ||
          !Number.isInteger(second.count) ||
          second.count < 1 ||
          second.count > 200 ||
          !Number.isFinite(second.spacing) ||
          (second.spacingExpression !== undefined && typeof second.spacingExpression !== 'string') ||
          (second.countExpression !== undefined && typeof second.countExpression !== 'string') ||
          (second.centered !== undefined && second.centered !== true))) ||
      (skipped !== undefined &&
        (!Array.isArray(skipped) || skipped.some(at => !Array.isArray(at) || at.length !== 2 || !at.every(Number.isInteger))))
    )
      throw new Error('Invalid CAD pattern grid');
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
  // History details are formatted during folder validation below, before geometry is evaluated.
  if (p.moved !== undefined) {
    const moved = p.moved;
    if (!moved || typeof moved !== 'object' || Array.isArray(moved)) throw new Error('Invalid CAD part transform');
    if ('by' in moved) {
      checkVector(moved.by);
      if (
        moved.byExpressions !== undefined &&
        (!Array.isArray(moved.byExpressions) ||
          moved.byExpressions.length !== 3 ||
          [...moved.byExpressions].some(expression => expression !== null && typeof expression !== 'string'))
      )
        throw new Error('Invalid CAD transform expressions');
      if (moved.turn !== undefined) {
        const turn = moved.turn;
        if (!turn || typeof turn !== 'object' || Array.isArray(turn)) throw new Error('Invalid CAD turn');
        checkVector(turn.about);
        checkVector(turn.axis);
        if (Math.hypot(...turn.axis) === 0) throw new Error('Invalid CAD turn axis');
        number(turn.degrees);
        if (turn.degreesExpression !== undefined && typeof turn.degreesExpression !== 'string') throw new Error('Invalid CAD turn');
      }
    } else {
      checkDirection(moved);
      number(moved.distance);
    }
  }
  if (p.fillets !== undefined) {
    if (!Array.isArray(p.fillets)) throw new Error('Invalid CAD fillets');
    for (const fillet of p.fillets) {
      if (!fillet || typeof fillet !== 'object' || !Array.isArray(fillet.corners)) throw new Error('Invalid CAD fillet');
      addId(fillet.id);
      for (const corner of fillet.corners) reference(corner);
      number(fillet.radius);
      if (fillet.radiusExpression !== undefined && typeof fillet.radiusExpression !== 'string') throw new Error('Invalid CAD fillet');
      if (fillet.suppressed !== undefined && typeof fillet.suppressed !== 'boolean') throw new Error('Invalid CAD fillet');
      if (fillet.chamfer !== undefined && fillet.chamfer !== true) throw new Error('Invalid CAD fillet');
      if (fillet.rims !== undefined) {
        if (!Array.isArray(fillet.rims)) throw new Error('Invalid CAD fillet');
        for (const rim of fillet.rims)
          if (
            !rim ||
            typeof rim !== 'object' ||
            (rim.side !== 'top' && rim.side !== 'underside') ||
            !Array.isArray(rim.loops) ||
            !rim.loops.length ||
            rim.loops.some((loop: unknown) => typeof loop !== 'string' || !loop) ||
            (rim.face !== undefined && rim.face !== true) ||
            (rim.lines !== undefined && (!Array.isArray(rim.lines) || rim.lines.some((line: unknown) => typeof line !== 'string')))
          )
            throw new Error('Invalid CAD fillet');
      }
    }
  }
  if (p.thinWall !== undefined) {
    const wall = p.thinWall;
    if (!wall || typeof wall !== 'object') throw new Error('Invalid CAD thin wall');
    number(wall.thickness1);
    number(wall.thickness2);
    if (wall.thickness1 < 0 || wall.thickness2 < 0 || wall.thickness1 + wall.thickness2 <= 0) throw new Error('Invalid CAD thin wall');
    for (const key of ['thickness1Expression', 'thickness2Expression'] as const)
      if (wall[key] !== undefined && typeof wall[key] !== 'string') throw new Error('Invalid CAD thin wall');
    if (wall.midPlane !== undefined && wall.midPlane !== true) throw new Error('Invalid CAD thin wall');
  }
  if (
    p.thinEdges !== undefined &&
    (!p.thinWall ||
      !Array.isArray(p.thinEdges) ||
      !p.thinEdges.length ||
      p.thinEdges.some(id => typeof id !== 'string' || !p.sketch.entities.some(entity => entity.id === id && entity.type === 'line')))
  )
    throw new Error('Invalid CAD thin edges');
  if (
    (p.piece !== undefined &&
      (!p.piece ||
        typeof p.piece !== 'object' ||
        !['sketchId', 'regionId', 'by'].every(key => typeof (p.piece as unknown as Record<string, unknown>)[key] === 'string'))) ||
    (p.pieceOf !== undefined && (!p.pieceOf || typeof p.pieceOf.partId !== 'string' || typeof p.pieceOf.by !== 'string'))
  )
    throw new Error('Invalid CAD part piece');
  if (p.material !== undefined) {
    const material = p.material as unknown as Record<string, unknown> | null;
    if (!material || typeof material.name !== 'string' || !material.name) throw new Error('Invalid CAD material');
    number(material.density);
  }
  if (p.split !== undefined) {
    const split = p.split as unknown as Record<string, unknown> | null;
    const across = split?.across as Record<string, unknown> | undefined;
    if (
      !split ||
      typeof split.id !== 'string' ||
      !across ||
      typeof across !== 'object' ||
      ('plane' in across ? !['top', 'front', 'right'].includes(across.plane as string) : typeof across.partId !== 'string') ||
      (split.datum !== undefined && typeof split.datum !== 'string') ||
      (split.suppressed !== undefined && split.suppressed !== true) ||
      (split.fromCopy !== undefined && split.fromCopy !== true)
    )
      throw new Error('Invalid CAD split');
    addId(split.id);
    const line = split.line as Record<string, unknown> | undefined;
    if (line !== undefined) for (const key of ['x', 'y', 'nx', 'ny'] as const) number(line[key]);
  }
  if (p.mirrorJoins !== undefined) {
    if (!Array.isArray(p.mirrorJoins) || !p.mirrorJoins.length) throw new Error('Invalid CAD mirror');
    for (const join of p.mirrorJoins) {
      if (!join || typeof join !== 'object' || !join.across || typeof join.across !== 'object') throw new Error('Invalid CAD mirror');
      addId(join.id);
      const across = join.across as Record<string, unknown>;
      if ('plane' in across ? !['top', 'front', 'right'].includes(across.plane as string) : typeof across.partId !== 'string')
        throw new Error('Invalid CAD mirror');
      if (join.datum !== undefined && typeof join.datum !== 'string') throw new Error('Invalid CAD mirror');
      if (join.suppressed !== undefined && typeof join.suppressed !== 'boolean') throw new Error('Invalid CAD mirror');
      if (join.line !== undefined) for (const key of ['x', 'y', 'nx', 'ny'] as const) number(join.line[key]);
    }
  }
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
}
